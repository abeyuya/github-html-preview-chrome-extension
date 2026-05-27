export interface BlobLocation {
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

/** Directory URL on raw.githubusercontent.com that relative assets resolve against. */
export function rawBaseUrl(loc: BlobLocation): string {
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
  const [owner, repo, ref] = [loc.owner, loc.repo, loc.ref].map((s) =>
    encodeURIComponent(s)
  );
  return `https://github.com/${owner}/${repo}/raw/${ref}/${rest}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
