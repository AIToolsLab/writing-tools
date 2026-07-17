import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173", headless: true },
  webServer: {
    // PORT suppresses Vite's interactive browser-open behavior; Playwright owns
    // the browser and can reliably stop this direct Node child afterwards.
    command: "set PORT=4173&& node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
