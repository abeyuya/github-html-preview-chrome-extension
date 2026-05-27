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
 * Rewrite relative asset references in the given HTML so they point at
 * raw.githubusercontent.com, and inject a <base> tag as a catch-all.
 */
export function resolveHtml(html: string, loc: BlobLocation): string {
  const base = rawBaseUrl(loc);
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

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
