const SANDBOX_URL = chrome.runtime.getURL("src/sandbox/index.html");

const OVERLAY_ID = "ghp-preview-overlay";

// Height used before the previewed content reports its own size, and the floor
// the overlay never shrinks below.
const DEFAULT_HEIGHT = 480;

let overlay: HTMLIFrameElement | null = null;
let anchorEl: HTMLElement | null = null;
let pendingHtml: string | null = null;
let messageListener: ((event: MessageEvent) => void) | null = null;
let savedPosition = "";
let savedHeight = "";
let savedOverflow = "";

/** Mount the sandbox iframe over the file content area and render the HTML. */
export function showPreview(anchor: HTMLElement, html: string): void {
  hidePreview();
  pendingHtml = html;
  anchorEl = anchor;

  // Constrain the content container to the preview height so the long source
  // view behind it neither shows through nor leaves blank space below.
  savedPosition = anchor.style.position;
  savedHeight = anchor.style.height;
  savedOverflow = anchor.style.overflow;
  anchor.style.position = "relative";
  anchor.style.height = `${DEFAULT_HEIGHT}px`;
  anchor.style.overflow = "hidden";

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
    } else if (data.type === "height" && typeof data.height === "number" && anchorEl) {
      anchorEl.style.height = `${Math.max(data.height, DEFAULT_HEIGHT)}px`;
    }
  };
  window.addEventListener("message", messageListener);

  anchor.appendChild(overlay);
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
  if (anchorEl) {
    anchorEl.style.position = savedPosition;
    anchorEl.style.height = savedHeight;
    anchorEl.style.overflow = savedOverflow;
    anchorEl = null;
  }
  pendingHtml = null;
}

export function isPreviewVisible(): boolean {
  return overlay !== null;
}
