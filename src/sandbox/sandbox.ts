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
  // No "allow-scripts": JavaScript inside the previewed HTML never runs.
  frame.setAttribute("sandbox", "allow-same-origin");
  frame.srcdoc = html;
  document.body.appendChild(frame);
}

window.addEventListener("message", (event: MessageEvent) => {
  if (!isRenderMessage(event.data)) return;
  render(event.data.html);
});

// Tell the content script we are ready to receive the HTML.
if (window.parent !== window) {
  window.parent.postMessage(
    { source: "github-html-preview", type: "ready" },
    "*"
  );
}
