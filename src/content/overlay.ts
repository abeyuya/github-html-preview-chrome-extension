import { authenticatedRawUrl, type BlobLocation } from "./resolvePaths";

const SANDBOX_URL = chrome.runtime.getURL("src/sandbox/index.html");

const OVERLAY_ID = "ghp-preview-overlay";

let overlay: HTMLIFrameElement | null = null;
let pending: { html: string; base: string } | null = null;
let currentLocation: BlobLocation | null = null;
let hiddenElements: { el: HTMLElement; previousDisplay: string }[] = [];
let messageListener: ((event: MessageEvent) => void) | null = null;

// GitHub's React blob view layers a transparent textarea over the highlighted
// code so the source can be selected and copied. It is not a descendant of the
// code container, so hiding only the code leaves this textarea on top of the
// preview iframe, where it swallows clicks and hijacks text selection onto the
// hidden source. React mounts it outside the code container's parent (next to
// the line-menu/copilot positioners), so it must be located document-wide
// rather than scoped to the code container, and hidden alongside the code.
// The cursor container is a separate sibling of both the code container and the
// selection textarea (not an ancestor of either). It is sized to the full
// original source height and keeps `pointer-events`, so on top of the preview a
// bare child div of it is the topmost element at the preview's coordinates and
// swallows clicks, while below the (typically shorter) preview it reserves the
// original line count's height and leaves a tall blank scroll area. Hiding the
// textarea alone does not touch it, so it must be hidden as its own target.
const SELECTION_OVERLAY_SELECTORS = [
  "#read-only-cursor-text-area",
  "textarea.react-blob-textarea",
  '[class*="cursorContainer"]',
];

function hideElement(el: HTMLElement): void {
  hiddenElements.push({ el, previousDisplay: el.style.display });
  el.style.display = "none";
}

function findSelectionOverlays(): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const selector of SELECTION_OVERLAY_SELECTORS) {
    for (const el of document.querySelectorAll<HTMLElement>(selector)) {
      found.add(el);
    }
  }
  return [...found];
}

/**
 * Replace the raw source view with the sandbox iframe and hand it the raw HTML
 * plus the base URL. The sandbox rewrites and renders the HTML under its own
 * permissive CSP, so no rewriting happens in github.com's CSP context.
 */
export function showPreview(
  anchor: HTMLElement,
  html: string,
  base: string,
  loc: BlobLocation
): void {
  hidePreview();
  pending = { html, base };
  currentLocation = loc;

  overlay = document.createElement("iframe");
  overlay.id = OVERLAY_ID;
  overlay.src = SANDBOX_URL;

  messageListener = (event: MessageEvent) => {
    if (event.source !== overlay?.contentWindow) return;
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    if (data.source !== "github-html-preview") return;

    if (data.type === "ready" && pending !== null) {
      overlay?.contentWindow?.postMessage(
        {
          source: "github-html-preview",
          type: "render",
          html: pending.html,
          base: pending.base,
        },
        "*"
      );
    }

    if (data.type === "resource-request") {
      handleResourceRequest(data.id, data.url);
    }

    // Grow the overlay to fit the rendered content so long pages are not
    // clipped at the default viewport-based height.
    if (
      data.type === "content-height" &&
      typeof data.height === "number" &&
      overlay !== null &&
      data.height > 0
    ) {
      overlay.style.height = `${data.height}px`;
    }
  };
  window.addEventListener("message", messageListener);

  // Hide the original source view instead of overlaying it, so the raw code
  // never shows through below the preview, and hide the transparent selection
  // textarea layered on top of it so clicks and selection reach the preview.
  hideElement(anchor);
  for (const el of findSelectionOverlays()) {
    hideElement(el);
  }
  anchor.parentElement?.insertBefore(overlay, anchor);
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
  for (const { el, previousDisplay } of hiddenElements) {
    el.style.display = previousDisplay;
  }
  hiddenElements = [];
  pending = null;
  currentLocation = null;
}

export function isPreviewVisible(): boolean {
  return overlay !== null;
}
