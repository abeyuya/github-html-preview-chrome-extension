import { extractSource } from "./extractSource";
import { parseBlobLocation, resolveHtml } from "./resolvePaths";
import { showPreview, hidePreview, isPreviewVisible } from "./overlay";
import { createToggleButton, setButtonState, BUTTON_ID } from "./button";

const HTML_BLOB_RE =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[^/]+\/.+\.(html?|htm)(?:[?#].*)?$/i;

const TOOLBAR_SELECTORS = [
  "react-blob-header-edit-and-raw-actions",
  '[data-testid="raw-button"]',
  ".file-actions .BtnGroup",
  ".file-actions",
];

const CONTENT_SELECTORS = [
  '[data-testid="blob-viewer-file-content"]',
  ".react-code-view-bottom-padding",
  ".react-code-view",
  ".Box.mt-3 .blob-wrapper",
  ".blob-wrapper",
];

let toggleButton: HTMLButtonElement | null = null;

function isHtmlBlobPage(): boolean {
  return HTML_BLOB_RE.test(location.href);
}

function findToolbar(): HTMLElement | null {
  for (const selector of TOOLBAR_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      const parent = el.parentElement;
      return parent ?? el;
    }
  }
  return null;
}

function findContentContainer(): HTMLElement | null {
  for (const selector of CONTENT_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

function toggle(): void {
  if (!toggleButton) return;

  if (isPreviewVisible()) {
    hidePreview();
    setButtonState(toggleButton, false);
    return;
  }

  const source = extractSource();
  const location = parseBlobLocation(window.location.href);
  const container = findContentContainer();
  if (!source || !location || !container) return;

  const html = resolveHtml(source, location);
  showPreview(container, html);
  setButtonState(toggleButton, true);
}

function injectButton(): void {
  if (document.getElementById(BUTTON_ID)) return;
  const toolbar = findToolbar();
  if (!toolbar) return;
  // Only show the button once the source is actually extractable.
  if (extractSource() === null) return;

  toggleButton = createToggleButton(toggle);
  const wrapper = document.createElement("span");
  wrapper.className = "ghp-preview-toggle-wrapper";
  wrapper.appendChild(toggleButton);
  toolbar.insertBefore(wrapper, toolbar.firstChild);
}

function cleanup(): void {
  hidePreview();
  document.getElementById(BUTTON_ID)?.closest(".ghp-preview-toggle-wrapper")?.remove();
  document.getElementById(BUTTON_ID)?.remove();
  toggleButton = null;
}

function evaluate(): void {
  if (isHtmlBlobPage()) {
    injectButton();
  } else {
    cleanup();
  }
}

// Re-evaluate on initial load, SPA navigation, and DOM mutations.
function watchNavigation(): void {
  document.addEventListener("turbo:load", evaluate);
  document.addEventListener("turbo:render", evaluate);
  window.addEventListener("popstate", evaluate);

  let lastUrl = location.href;
  const observer = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      cleanup();
    }
    if (isHtmlBlobPage() && !document.getElementById(BUTTON_ID)) {
      injectButton();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

evaluate();
watchNavigation();
