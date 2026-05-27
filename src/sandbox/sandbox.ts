interface RenderMessage {
  source: "github-html-preview";
  type: "render";
  html: string;
}

function isRenderMessage(data: unknown): data is RenderMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as RenderMessage).source === "github-html-preview" &&
    (data as RenderMessage).type === "render" &&
    typeof (data as RenderMessage).html === "string"
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

function isPreviewMessage(data: unknown): data is { type: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === "github-html-preview" &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

window.addEventListener("message", (event: MessageEvent) => {
  if (isRenderMessage(event.data)) {
    render(event.data.html);
    return;
  }
  if (!isPreviewMessage(event.data)) return;

  // Relay the resource proxy protocol between the previewed srcdoc iframe and
  // the content script: requests bubble up to the parent, responses go back
  // down to the frame.
  if (
    event.data.type === "resource-request" &&
    frame &&
    event.source === frame.contentWindow
  ) {
    window.parent.postMessage(event.data, "*");
  } else if (
    event.data.type === "resource-response" &&
    event.source === window.parent
  ) {
    frame?.contentWindow?.postMessage(event.data, "*");
  }
});

// Tell the content script we are ready to receive the HTML.
if (window.parent !== window) {
  window.parent.postMessage(
    { source: "github-html-preview", type: "ready" },
    "*"
  );
}
