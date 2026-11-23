import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e-real',
	testMatch: '*.spec.ts',
	fullyParallel: false,
	workers: 1,
	forbidOnly: !!process.env.CI,
	retries: 0,
	timeout: 30_000,
	reporter: [['list']],
	outputDir: 'test-results/integration',
	use: {
		baseURL: 'http://127.0.0.1:4317',
		trace: 'retain-on-failure',
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command:
			'node --import ../backend/node_modules/tsx/dist/loader.mjs e2e-real/server.mjs',
		url: 'http://127.0.0.1:4317/api/ping',
		reuseExistingServer: false,
		timeout: 60_000,
		gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
	},
});
