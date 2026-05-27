/**
 * Rewrite relative asset references in the given HTML so they point at
 * raw.githubusercontent.com, and inject a <base> tag as a catch-all.
 *
 * This runs inside the sandbox page (chrome-extension origin) rather than the
 * content script: the sandbox CSP has no `base-uri` restriction, so injecting
 * a cross-origin <base> here does not trip github.com's `base-uri 'self'`.
 */
export function resolveHtml(html: string, base: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");

  injectBase(doc, base);
  injectUrlShim(doc, base);
  injectFetchProxy(doc, base);
  rewriteAttribute(doc, "link[href]", "href", base);
  rewriteAttribute(doc, "script[src]", "src", base);
  rewriteAttribute(doc, "img[src]", "src", base);
  rewriteAttribute(doc, "source[src]", "src", base);
  injectHeightReporter(doc);

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

/**
 * The repo + ref root of `base`, e.g. `https://raw.githubusercontent.com/o/r/ref/`.
 * Runtime requests within this prefix are proxied through the content script so
 * private-repo assets load with the user's session. Returns null if `base` is
 * not a raw.githubusercontent.com URL with at least owner/repo/ref segments.
 */
function rawScopeFromBase(base: string): string | null {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.hostname !== "raw.githubusercontent.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 3) return null;
  return `${url.origin}/${parts.slice(0, 3).join("/")}/`;
}

/**
 * Inject a shim that intercepts the previewed page's `fetch` / `XMLHttpRequest`
 * for its own repo's raw assets (e.g. a Swagger UI page fetching its OpenAPI
 * document) and proxies them up to the content script, which can read them with
 * the user's GitHub session. This is what makes private-repo assets load; the
 * sandboxed iframe itself has no GitHub access. Out-of-scope requests fall
 * through to the native implementation untouched.
 */
function injectFetchProxy(doc: Document, base: string): void {
  const scope = rawScopeFromBase(base);
  if (!scope) return;
  const head = doc.head;
  if (!head) return;
  const script = doc.createElement("script");
  script.textContent = fetchProxySource(scope);
  head.insertBefore(script, head.firstChild);
}

// Posts the rendered document height up to the sandbox page so the overlay
// iframe can grow to fit its content instead of clipping it at a fixed height.
// Runs inside the opaque-origin sandboxed iframe, so the sandbox page cannot
// measure the height directly and relies on this self-contained reporter.
const HEIGHT_REPORTER = `(function(){
  function post(){
    var h = Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    );
    parent.postMessage({source:"github-html-preview",type:"content-height",height:h},"*");
  }
  window.addEventListener("load", post);
  window.addEventListener("resize", post);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(post).observe(document.documentElement);
  }
  post();
})();`;

function injectHeightReporter(doc: Document): void {
  const script = doc.createElement("script");
  script.textContent = HEIGHT_REPORTER;
  (doc.body ?? doc.documentElement).appendChild(script);
}

// The preview runs inside a srcdoc iframe sandboxed without `allow-same-origin`,
// so the page's `window.location.href` is `about:srcdoc` — a "cannot-be-a-base"
// URL. Page scripts that resolve relative paths against `location` (e.g. Swagger
// UI resolving its spec URL) call `new URL(rel, location.href)`, which throws
// "Failed to construct 'URL': Invalid URL" and aborts the page, leaving a blank
// preview. The `<base>` tag only fixes declarative resource loading, not runtime
// URL construction. This shim retries failing `URL` constructions against the
// real base, so it only changes behavior for calls that would otherwise throw.
function injectUrlShim(doc: Document, base: string): void {
  const head = doc.head;
  if (!head) return;
  const script = doc.createElement("script");
  script.textContent = `(function () {
  var BASE = ${JSON.stringify(base)};
  var Native = window.URL;
  if (!Native) return;
  function Patched(url, base) {
    if (arguments.length >= 2) {
      try { return new Native(url, base); }
      catch (e) { try { return new Native(url, BASE); } catch (_) { throw e; } }
    }
    try { return new Native(url); }
    catch (e) { try { return new Native(url, BASE); } catch (_) { throw e; } }
  }
  Patched.prototype = Native.prototype;
  ["createObjectURL", "revokeObjectURL", "canParse", "parse"].forEach(function (m) {
    if (typeof Native[m] === "function") {
      Patched[m] = function () { return Native[m].apply(Native, arguments); };
    }
  });
  try { window.URL = Patched; } catch (_) {}
})();`;
  head.insertBefore(script, head.firstChild);
}

function injectBase(doc: Document, base: string): void {
  let head = doc.head;
  if (!head) {
    head = doc.createElement("head");
    doc.documentElement.insertBefore(head, doc.documentElement.firstChild);
  }
  const baseEl = doc.createElement("base");
  baseEl.setAttribute("href", base);
  head.insertBefore(baseEl, head.firstChild);
}

function rewriteAttribute(
  doc: Document,
  selector: string,
  attr: string,
  base: string
): void {
  for (const el of Array.from(doc.querySelectorAll(selector))) {
    const value = el.getAttribute(attr);
    if (!value || !isRelative(value)) continue;
    try {
      el.setAttribute(attr, new URL(value, base).href);
    } catch {
      // Leave the original value if it cannot be resolved.
    }
  }
}

function isRelative(value: string): boolean {
  const v = value.trim();
  if (v === "") return false;
  // Absolute URLs, protocol-relative, data/blob/anchors stay untouched.
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false; // has a scheme
  if (v.startsWith("//")) return false;
  if (v.startsWith("#")) return false;
  return true;
}

// Source of the fetch/XHR proxy shim. It runs in the sandboxed srcdoc iframe
// (opaque origin, no GitHub access) and bridges in-scope raw requests up to the
// content script via postMessage, which fetches them with the user's session.
function fetchProxySource(scope: string): string {
  return `(function () {
  var SCOPE = ${JSON.stringify(scope)};
  var pending = Object.create(null);
  var seq = 0;

  function resolveUrl(input) {
    try {
      if (typeof input === "string") return new URL(input, document.baseURI).href;
      if (input instanceof URL) return input.href;
      if (input && typeof input.url === "string") return new URL(input.url, document.baseURI).href;
    } catch (e) {}
    return null;
  }

  function inScope(url) {
    return typeof url === "string" && url.indexOf(SCOPE) === 0;
  }

  function requestResource(url) {
    return new Promise(function (resolve, reject) {
      var id = "ghp-" + (++seq) + "-" + Date.now();
      pending[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage(
        { source: "github-html-preview", type: "resource-request", id: id, url: url },
        "*"
      );
    });
  }

  window.addEventListener("message", function (event) {
    var data = event.data;
    if (!data || data.source !== "github-html-preview" || data.type !== "resource-response") return;
    var entry = pending[data.id];
    if (!entry) return;
    delete pending[data.id];
    if (data.error) entry.reject(new Error(data.error));
    else entry.resolve(data);
  });

  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function (input, init) {
      var url = resolveUrl(input);
      if (inScope(url)) {
        return requestResource(url).then(function (d) {
          var headers = {};
          if (d.contentType) headers["content-type"] = d.contentType;
          var nullBody =
            d.status === 101 || d.status === 103 || d.status === 204 ||
            d.status === 205 || d.status === 304;
          return new Response(d.ok && !nullBody ? d.body : null, {
            status: d.status,
            statusText: d.statusText || "",
            headers: headers
          });
        });
      }
      return nativeFetch(input, init);
    };
  }

  var NativeXHR = window.XMLHttpRequest;
  if (NativeXHR) {
    var nativeOpen = NativeXHR.prototype.open;
    var nativeSend = NativeXHR.prototype.send;
    var nativeSetHeader = NativeXHR.prototype.setRequestHeader;
    NativeXHR.prototype.open = function (method, url) {
      this.__ghpUrl = resolveUrl(url);
      this.__ghpProxy = inScope(this.__ghpUrl);
      if (this.__ghpProxy) return;
      return nativeOpen.apply(this, arguments);
    };
    NativeXHR.prototype.setRequestHeader = function () {
      if (this.__ghpProxy) return;
      return nativeSetHeader.apply(this, arguments);
    };
    NativeXHR.prototype.send = function () {
      var xhr = this;
      if (!xhr.__ghpProxy) return nativeSend.apply(this, arguments);
      requestResource(xhr.__ghpUrl).then(
        function (d) { finishXhr(xhr, d, null); },
        function (err) { finishXhr(xhr, null, err); }
      );
    };
  }

  function define(obj, name, value) {
    try {
      Object.defineProperty(obj, name, { configurable: true, get: function () { return value; } });
    } catch (e) {}
  }

  function finishXhr(xhr, d, err) {
    var text = "";
    if (d && d.body) {
      try { text = new TextDecoder().decode(new Uint8Array(d.body)); } catch (e) {}
    }
    var contentType = d && d.contentType ? d.contentType : "";
    define(xhr, "readyState", 4);
    define(xhr, "status", err ? 0 : d.status);
    define(xhr, "statusText", err ? "" : (d.statusText || ""));
    define(xhr, "responseText", text);
    define(xhr, "responseURL", xhr.__ghpUrl);
    define(xhr, "response", xhrResponse(xhr, text, d));
    xhr.getResponseHeader = function (name) {
      return String(name).toLowerCase() === "content-type" && contentType ? contentType : null;
    };
    xhr.getAllResponseHeaders = function () {
      return contentType ? "content-type: " + contentType + "\\r\\n" : "";
    };
    dispatch(xhr, "readystatechange");
    dispatch(xhr, err ? "error" : "load");
    dispatch(xhr, "loadend");
  }

  function xhrResponse(xhr, text, d) {
    var type = xhr.responseType;
    if (type === "json") { try { return JSON.parse(text); } catch (e) { return null; } }
    if (type === "arraybuffer") return d && d.body ? d.body : new ArrayBuffer(0);
    if (type === "blob") return new Blob([d && d.body ? d.body : ""], { type: d && d.contentType ? d.contentType : "" });
    return text;
  }

  function dispatch(xhr, type) {
    try { xhr.dispatchEvent(new Event(type)); } catch (e) {}
  }
})();`;
}
