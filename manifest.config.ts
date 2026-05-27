import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "__MSG_extName__",
  description: "__MSG_extDescription__",
  version: "1.0.0",
  default_locale: "en",
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  content_scripts: [
    {
      matches: ["https://github.com/*"],
      js: ["src/content/index.ts"],
      css: ["src/content/content.css"],
      run_at: "document_idle",
    },
  ],
  sandbox: {
    pages: ["src/sandbox/index.html"],
  },
  // The previewed HTML runs inside a srcdoc iframe that inherits this sandbox
  // page's CSP, so it must permit the external scripts/styles/assets an
  // arbitrary previewed page may reference (e.g. Swagger UI's CDN bundle).
  // Permissive policies and unsafe-eval are only allowed for the sandbox CSP,
  // never for extension_pages.
  content_security_policy: {
    sandbox:
      "sandbox allow-scripts allow-popups allow-forms; " +
      "script-src * 'unsafe-inline' 'unsafe-eval' data: blob:; " +
      "style-src * 'unsafe-inline' data:; " +
      "img-src * data: blob:; " +
      "font-src * data:; " +
      "connect-src *; " +
      "frame-src *; " +
      "child-src *; " +
      "media-src * data: blob:;",
  },
  web_accessible_resources: [
    {
      resources: ["src/sandbox/index.html"],
      matches: ["https://github.com/*"],
    },
  ],
});
