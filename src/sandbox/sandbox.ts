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

// Injected into the previewed HTML so it can report its content height. The
// inner iframe is opaque-origin sandboxed, so its document cannot be measured
// from outside; instead it posts its own scrollHeight up to this sandbox page,
// which forwards it to the content script to size the overlay to fit.
const HEIGHT_REPORTER = `<script>(function(){function r(){var d=document;var h=Math.max(d.documentElement.scrollHeight,d.body?d.body.scrollHeight:0);parent.postMessage({source:"github-html-preview",type:"height",height:h},"*");}window.addEventListener("load",r);window.addEventListener("resize",r);if(window.ResizeObserver){new ResizeObserver(r).observe(document.documentElement);}r();})();<\/script>`;

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
  frame.srcdoc = html + HEIGHT_REPORTER;
  document.body.appendChild(frame);
}

window.addEventListener("message", (event: MessageEvent) => {
  // Forward content-height reports from the previewed page up to the content
  // script so it can size the overlay to the rendered content.
  const data = event.data;
  if (
    frame &&
    event.source === frame.contentWindow &&
    typeof data === "object" &&
    data !== null &&
    data.source === "github-html-preview" &&
    data.type === "height" &&
    typeof data.height === "number"
  ) {
    window.parent.postMessage(
      { source: "github-html-preview", type: "height", height: data.height },
      "*"
    );
    return;
  }

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
