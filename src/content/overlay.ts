import { authenticatedRawUrl } from "./resolvePaths";

const SANDBOX_URL = chrome.runtime.getURL("src/sandbox/index.html");

const OVERLAY_ID = "ghp-preview-overlay";

interface BlobLocation {
  owner: string;
  repo: string;
  ref: string;
  dir: string;
}

let overlay: HTMLIFrameElement | null = null;
let pendingHtml: string | null = null;
let currentLocation: BlobLocation | null = null;
let messageListener: ((event: MessageEvent) => void) | null = null;

/** Mount the sandbox iframe over the file content area and render the HTML. */
export function showPreview(
  anchor: HTMLElement,
  html: string,
  loc: BlobLocation
): void {
  hidePreview();
  pendingHtml = html;
  currentLocation = loc;

  overlay = document.createElement("iframe");
  overlay.id = OVERLAY_ID;
  overlay.src = SANDBOX_URL;

  messageListener = (event: MessageEvent) => {
    if (event.source !== overlay?.contentWindow) return;
    const data = event.data;
    if (
      typeof data !== "object" ||
      data === null ||
      data.source !== "github-html-preview"
    ) {
      return;
    }
    if (data.type === "ready" && pendingHtml !== null) {
      overlay?.contentWindow?.postMessage(
        { source: "github-html-preview", type: "render", html: pendingHtml },
        "*"
      );
    } else if (data.type === "resource-request") {
      handleResourceRequest(data.id, data.url);
    }
  };
  window.addEventListener("message", messageListener);

  anchor.appendChild(overlay);
}

/**
 * Fetch a same-repo raw asset on behalf of the sandboxed preview, using the
 * page's GitHub session so private repositories work, then post the bytes back
 * to the sandbox. Requests outside the previewed repo/ref scope are refused.
 */
async function handleResourceRequest(id: unknown, url: unknown): Promise<void> {
  const reply = (payload: Record<string, unknown>) => {
    overlay?.contentWindow?.postMessage(
      { source: "github-html-preview", type: "resource-response", id, ...payload },
      "*"
    );
  };

  if (typeof id !== "string" || typeof url !== "string" || !currentLocation) {
    reply({ error: "Invalid resource request." });
    return;
  }

  const target = authenticatedRawUrl(url, currentLocation);
  if (!target) {
    reply({ error: "Resource is outside the previewed repository scope." });
    return;
  }

  try {
    const res = await fetch(target);
    const body = await res.arrayBuffer();
    reply({
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      contentType: res.headers.get("content-type") ?? "",
      body,
    });
  } catch (err) {
    reply({ error: err instanceof Error ? err.message : "Fetch failed." });
  }
}

export function hidePreview(): void {
  if (messageListener) {
    window.removeEventListener("message", messageListener);
    messageListener = null;
  }
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  pendingHtml = null;
  currentLocation = null;
}

export function isPreviewVisible(): boolean {
  return overlay !== null;
}
