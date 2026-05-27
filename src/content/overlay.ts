const SANDBOX_URL = chrome.runtime.getURL("src/sandbox/index.html");

const OVERLAY_ID = "ghp-preview-overlay";

let overlay: HTMLIFrameElement | null = null;
let pendingHtml: string | null = null;
let readyListener: ((event: MessageEvent) => void) | null = null;

/** Mount the sandbox iframe over the file content area and render the HTML. */
export function showPreview(anchor: HTMLElement, html: string): void {
  hidePreview();
  pendingHtml = html;

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
      pendingHtml !== null
    ) {
      overlay?.contentWindow?.postMessage(
        { source: "github-html-preview", type: "render", html: pendingHtml },
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
  pendingHtml = null;
}

export function isPreviewVisible(): boolean {
  return overlay !== null;
}
