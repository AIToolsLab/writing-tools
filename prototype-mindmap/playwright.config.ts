import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4173);
const viteCommand =
  process.platform === "win32"
    ? `set PORT=${port}&& node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port}`
    : `PORT=${port} node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${port}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  webServer: process.env.PLAYWRIGHT_SKIP_SERVER ? undefined : {
    // Keep this on Vite's development server: launcher enforcement is intentionally
    // off here. The production build is compiled separately in CI.
    command: viteCommand,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
