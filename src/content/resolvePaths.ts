interface BlobLocation {
  owner: string;
  repo: string;
  ref: string;
  /** Directory of the file, with no leading/trailing slash. "" for repo root. */
  dir: string;
}

const BLOB_PATH_RE =
  /^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.*)$/;

export function parseBlobLocation(url: string): BlobLocation | null {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }

  const match = pathname.match(BLOB_PATH_RE);
  if (!match) return null;

  const [, owner, repo, ref, filePath] = match;
  const decodedPath = safeDecode(filePath);
  const lastSlash = decodedPath.lastIndexOf("/");
  const dir = lastSlash === -1 ? "" : decodedPath.slice(0, lastSlash);

  return { owner, repo, ref, dir };
}

function rawBaseUrl(loc: BlobLocation): string {
  const segments = [
    loc.owner,
    loc.repo,
    loc.ref,
    ...(loc.dir ? loc.dir.split("/") : []),
  ].map((s) => encodeURIComponent(s));
  return `https://raw.githubusercontent.com/${segments.join("/")}/`;
}

/**
 * The raw.githubusercontent.com prefix that scopes which runtime requests the
 * preview is allowed to proxy: the repo + ref root of the previewed file.
 * Requests outside this prefix are refused so previewed scripts cannot read
 * arbitrary GitHub content through the user's session.
 */
export function rawScopePrefix(loc: BlobLocation): string {
  const segments = [loc.owner, loc.repo, loc.ref].map((s) =>
    encodeURIComponent(s)
  );
  return `https://raw.githubusercontent.com/${segments.join("/")}/`;
}

/**
 * Translate an in-scope raw.githubusercontent.com URL into the github.com
 * `/raw/` URL. That endpoint is same-origin to the content script, so the
 * fetch carries the user's session and works for private repositories.
 * Returns null when the URL is outside the previewed repo/ref scope.
 */
export function authenticatedRawUrl(
  rawUrl: string,
  loc: BlobLocation
): string | null {
  let normalized: string;
  try {
    // Normalize first so "../" traversal cannot escape the scope check below.
    normalized = new URL(rawUrl).href;
  } catch {
    return null;
  }
  const prefix = rawScopePrefix(loc);
  if (!normalized.startsWith(prefix)) return null;
  const rest = normalized.slice(prefix.length);
  const segments = [loc.owner, loc.repo, loc.ref].map((s) =>
    encodeURIComponent(s)
  );
  const [owner, repo, ref] = segments;
  return `https://github.com/${owner}/${repo}/raw/${ref}/${rest}`;
}

/**
 * Rewrite relative asset references in the given HTML so they point at
 * raw.githubusercontent.com, and inject a <base> tag as a catch-all.
 */
export function resolveHtml(html: string, loc: BlobLocation): string {
  const base = rawBaseUrl(loc);
  const doc = new DOMParser().parseFromString(html, "text/html");

  injectBase(doc, base);
  injectPrelude(doc, rawScopePrefix(loc));
  rewriteAttribute(doc, "link[href]", "href", base);
  rewriteAttribute(doc, "script[src]", "src", base);
  rewriteAttribute(doc, "img[src]", "src", base);
  rewriteAttribute(doc, "source[src]", "src", base);

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

function injectBase(doc: Document, base: string): void {
  const baseEl = doc.createElement("base");
  baseEl.setAttribute("href", base);
  const h = head(doc);
  h.insertBefore(baseEl, h.firstChild);
}

/**
 * Insert a runtime shim as the first executable script so that requests the
 * previewed page makes for its own repo's raw assets (e.g. a Swagger UI page
 * fetching its OpenAPI document) are proxied through the content script, which
 * can read them with the user's GitHub session. Also rewrites `about:srcdoc`
 * bases so `new URL(rel, location.href)` resolves against the real raw URL.
 */
function injectPrelude(doc: Document, scope: string): void {
  const script = doc.createElement("script");
  script.textContent = preludeSource(scope);
  const baseEl = head(doc).querySelector("base");
  head(doc).insertBefore(script, baseEl ? baseEl.nextSibling : head(doc).firstChild);
}

function head(doc: Document): HTMLHeadElement {
  if (!doc.head) {
    const created = doc.createElement("head");
    doc.documentElement.insertBefore(created, doc.documentElement.firstChild);
    return created;
  }
  return doc.head;
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

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Source of the inline shim injected into the previewed document. It runs in
 * the sandboxed srcdoc iframe (opaque origin, no GitHub access) and bridges
 * same-repo raw requests up to the content script via postMessage.
 */
function preludeSource(scope: string): string {
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

  // Rewrite an about:srcdoc base (the iframe's own location) to the real raw
  // base so new URL("../x", location.href) resolves correctly.
  var NativeURL = window.URL;
  window.URL = new Proxy(NativeURL, {
    construct: function (target, args) {
      if (args.length > 1 && typeof args[1] === "string" && args[1].indexOf("about:") === 0) {
        return new target(args[0], document.baseURI);
      }
      return args.length > 1 ? new target(args[0], args[1]) : new target(args[0]);
    }
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
