import { resolveHtml } from "./resolveHtml";

interface RenderMessage {
  source: "github-html-preview";
  type: "render";
  html: string;
  base: string;
}

function isRenderMessage(data: unknown): data is RenderMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as RenderMessage).source === "github-html-preview" &&
    (data as RenderMessage).type === "render" &&
    typeof (data as RenderMessage).html === "string" &&
    typeof (data as RenderMessage).base === "string"
  );
}

let frame: HTMLIFrameElement | null = null;

function render(html: string): void {
  if (frame) {
    frame.remove();
  }
  frame = document.createElement("iframe");
  // Run the previewed HTML's JavaScript inside this isolated iframe. It stays
  // within the MV3 sandbox page (opaque origin, no extension privileges, no
  // same-origin access to GitHub), and "allow-same-origin" is intentionally
  // omitted so the framed content cannot drop its own sandbox; the opaque
  // origin still loads CORS-enabled assets from raw.githubusercontent.com.
  frame.setAttribute("sandbox", "allow-scripts allow-popups allow-forms");
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

window.addEventListener("message", (event: MessageEvent) => {
  if (!isRenderMessage(event.data)) return;
  render(resolveHtml(event.data.html, event.data.base));
});

// Tell the content script we are ready to receive the HTML.
if (window.parent !== window) {
  window.parent.postMessage(
    { source: "github-html-preview", type: "ready" },
    "*"
  );
}
