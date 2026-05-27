const SANDBOX_URL = chrome.runtime.getURL("src/sandbox/index.html");

const OVERLAY_ID = "ghp-preview-overlay";

let overlay: HTMLIFrameElement | null = null;
let hiddenEl: HTMLElement | null = null;
let prevDisplay = "";
let pendingHtml: string | null = null;
let readyListener: ((event: MessageEvent) => void) | null = null;

/** Replace the code content area with the sandbox iframe and render the HTML. */
export function showPreview(codeEl: HTMLElement, html: string): void {
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

  // Hide the code lines and drop the preview into the same spot, so the toolbar
  // and commit header stay visible while the rendered output replaces the code.
  hiddenEl = codeEl;
  prevDisplay = codeEl.style.display;
  codeEl.style.display = "none";
  codeEl.parentElement?.insertBefore(overlay, codeEl);
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
  if (hiddenEl) {
    hiddenEl.style.display = prevDisplay;
    hiddenEl = null;
    prevDisplay = "";
  }
  pendingHtml = null;
}

export function isPreviewVisible(): boolean {
  return overlay !== null;
}
