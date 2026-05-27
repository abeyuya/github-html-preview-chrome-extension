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

function isContentHeightMessage(
  data: unknown
): data is { source: string; type: string; height: number } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === "github-html-preview" &&
    (data as { type?: unknown }).type === "content-height" &&
    typeof (data as { height?: unknown }).height === "number"
  );
}

window.addEventListener("message", (event: MessageEvent) => {
  // Height reports come from the inner preview iframe; relay them to the
  // content script so it can resize the overlay iframe to fit the content.
  if (event.source === frame?.contentWindow && isContentHeightMessage(event.data)) {
    if (window.parent !== window) {
      window.parent.postMessage(event.data, "*");
    }
    return;
  }
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
