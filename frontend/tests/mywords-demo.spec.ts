import { test, expect } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Records a video of each My Words interaction model playing the same scenario,
 * so the two can be watched side by side. Run with `npx playwright test
 * mywords-demo` after `npm run build` (the webServer serves dist/). Clips land
 * in frontend/mywords-videos/.
 */

// This environment ships a pre-installed Chromium that may not match the
// version @playwright/test would otherwise download. Prefer it when present.
const PREINSTALLED_CHROMIUM =
	'/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const launchOptions = fs.existsSync(PREINSTALLED_CHROMIUM)
	? { executablePath: PREINSTALLED_CHROMIUM }
	: {};

test.use({
	video: 'on',
	viewport: { width: 1100, height: 720 },
	launchOptions,
});

const OUT_DIR = path.resolve(__dirname, '..', 'mywords-videos');

for (const strategy of ['walkthrough', 'propose'] as const) {
	test(`my-words demo — ${strategy}`, async ({ page }) => {
		test.setTimeout(90_000);
		await page.goto(`/mywords-demo.html?strategy=${strategy}`);

		// The demo flips data-demo-state to "done" when the script finishes.
		await expect(page.locator('[data-demo-state]').first()).toHaveAttribute(
			'data-demo-state',
			'done',
			{ timeout: 60_000 },
		);
		await page.waitForTimeout(600);

		const video = page.video();
		await page.close(); // finalizes the recording
		if (video) {
			fs.mkdirSync(OUT_DIR, { recursive: true });
			await video.saveAs(path.join(OUT_DIR, `${strategy}.webm`));
		}
	});
}
