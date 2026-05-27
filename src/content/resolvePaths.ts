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

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
