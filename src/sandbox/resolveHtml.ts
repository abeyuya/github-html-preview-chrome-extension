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
  rewriteAttribute(doc, "link[href]", "href", base);
  rewriteAttribute(doc, "script[src]", "src", base);
  rewriteAttribute(doc, "img[src]", "src", base);
  rewriteAttribute(doc, "source[src]", "src", base);

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
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
