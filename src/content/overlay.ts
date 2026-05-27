const SANDBOX_URL = chrome.runtime.getURL("src/sandbox/index.html");

const OVERLAY_ID = "ghp-preview-overlay";

let overlay: HTMLIFrameElement | null = null;
let pending: { html: string; base: string } | null = null;
let hiddenContent: HTMLElement | null = null;
let previousDisplay = "";
let messageListener: ((event: MessageEvent) => void) | null = null;

/**
 * Replace the raw source view with the sandbox iframe and hand it the raw HTML
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
  pending = null;
}

export function isPreviewVisible(): boolean {
  return overlay !== null;
}
