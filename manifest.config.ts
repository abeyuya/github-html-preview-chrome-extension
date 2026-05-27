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
  web_accessible_resources: [
    {
      resources: ["src/sandbox/index.html"],
      matches: ["https://github.com/*"],
    },
  ],
});
