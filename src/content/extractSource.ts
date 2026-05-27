/**
 * Extract the raw text of the HTML file currently shown on a GitHub blob page,
 * using only what is already present in the DOM (no extra network requests).
 * Returns null when the source cannot be found.
 */
export function extractSource(): string | null {
  return (
    fromTextarea() ?? fromEmbeddedData() ?? fromRenderedLines() ?? null
  );
}

// New GitHub UI keeps the full file content in a hidden textarea.
function fromTextarea(): string | null {
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "textarea#read-only-cursor-text-area"
  );
  const value = textarea?.value;
  return value && value.length > 0 ? value : null;
}

// New GitHub UI embeds the file payload as JSON in a script tag.
function fromEmbeddedData(): string | null {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/json"][data-target="react-app.embeddedData"]'
  );
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? "");
      const rawLines: unknown = data?.payload?.blob?.rawLines;
      if (Array.isArray(rawLines)) {
        return rawLines.join("\n");
      }
    } catch {
      // Ignore malformed payloads and try the next candidate.
    }
  }
  return null;
}

// Fallback: reconstruct from the rendered code lines.
function fromRenderedLines(): string | null {
  const lines = document.querySelectorAll(".react-code-text .react-file-line");
  if (lines.length > 0) {
    return Array.from(lines)
      .map((line) => line.textContent ?? "")
      .join("\n");
  }

  const legacy = document.querySelectorAll<HTMLElement>(
    "table.highlight td.blob-code"
  );
  if (legacy.length > 0) {
    return Array.from(legacy)
      .map((cell) => cell.textContent ?? "")
      .join("\n");
  }

  return null;
}
