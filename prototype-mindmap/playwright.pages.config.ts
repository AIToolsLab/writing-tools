import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PAGES_PORT ?? 4174);

export default defineConfig({
  testDir: "./e2e-pages",
  timeout: 30_000,
  outputDir: "test-results/pages",
  reporter: [["html", { outputFolder: "playwright-report-pages", open: "never" }]],
  globalSetup: "./e2e-pages/global-setup.ts",
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
});
