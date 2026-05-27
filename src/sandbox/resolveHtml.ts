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
  rewriteAttribute(doc, "link[href]", "href", base);
  rewriteAttribute(doc, "script[src]", "src", base);
  rewriteAttribute(doc, "img[src]", "src", base);
  rewriteAttribute(doc, "source[src]", "src", base);
  injectHeightReporter(doc);

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
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
