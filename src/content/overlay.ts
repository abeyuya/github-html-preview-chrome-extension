const SANDBOX_URL = chrome.runtime.getURL("src/sandbox/index.html");

const OVERLAY_ID = "ghp-preview-overlay";

let overlay: HTMLIFrameElement | null = null;
let pending: { html: string; base: string } | null = null;
let readyListener: ((event: MessageEvent) => void) | null = null;

/**
 * Mount the sandbox iframe over the file content area and hand it the raw HTML
 * plus the base URL. The sandbox rewrites and renders the HTML under its own
 * permissive CSP, so no rewriting happens in github.com's CSP context.
 */
export function showPreview(
  anchor: HTMLElement,
  html: string,
  base: string
): void {
  hidePreview();
  pending = { html, base };

  overlay = document.createElement("iframe");
  overlay.id = OVERLAY_ID;
  overlay.src = SANDBOX_URL;

  readyListener = (event: MessageEvent) => {
    if (event.source !== overlay?.contentWindow) return;
    const data = event.data;
    if (
      typeof data === "object" &&
      data !== null &&
      data.source === "github-html-preview" &&
      data.type === "ready" &&
      pending !== null
    ) {
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
  };
  window.addEventListener("message", readyListener);

  anchor.appendChild(overlay);
}

export function hidePreview(): void {
  if (readyListener) {
    window.removeEventListener("message", readyListener);
    readyListener = null;
  }
  if (overlay) {
    overlay.remove();
    overlay = null;
  }
  pending = null;
}

export function isPreviewVisible(): boolean {
  return overlay !== null;
}
