const SANDBOX_URL = chrome.runtime.getURL("src/sandbox/index.html");

const OVERLAY_ID = "ghp-preview-overlay";

let overlay: HTMLIFrameElement | null = null;
let hiddenContent: HTMLElement | null = null;
let previousDisplay = "";
let pendingHtml: string | null = null;
let messageListener: ((event: MessageEvent) => void) | null = null;

/** Replace the raw source view with the sandbox iframe and render the HTML. */
export function showPreview(anchor: HTMLElement, html: string): void {
  hidePreview();
  pendingHtml = html;

  overlay = document.createElement("iframe");
  overlay.id = OVERLAY_ID;
  overlay.src = SANDBOX_URL;

  messageListener = (event: MessageEvent) => {
    if (event.source !== overlay?.contentWindow) return;
    const data = event.data;
    if (typeof data !== "object" || data === null) return;
    if (data.source !== "github-html-preview") return;

    if (data.type === "ready" && pendingHtml !== null) {
      overlay?.contentWindow?.postMessage(
        { source: "github-html-preview", type: "render", html: pendingHtml },
        "*"
      );
    }
  };
  window.addEventListener("message", messageListener);

  // Hide the original source view instead of overlaying it, so the raw code
  // never shows through below the preview.
  hiddenContent = anchor;
  previousDisplay = anchor.style.display;
  anchor.style.display = "none";
  anchor.parentElement?.insertBefore(overlay, anchor);
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
  if (hiddenContent) {
    hiddenContent.style.display = previousDisplay;
    hiddenContent = null;
    previousDisplay = "";
  }
  pendingHtml = null;
}

export function isPreviewVisible(): boolean {
  return overlay !== null;
}
