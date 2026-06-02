import { test, expect } from '@playwright/test';
import { setupMockBackend } from './mockBackend';

test('demo page - visual regression', async ({ page }) => {
  // Setup mock backend with actual API structure
  await setupMockBackend(page);

  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('Thoughtful');

  // Allow a small pixel budget so sub-visible rendering noise (font antialiasing,
  // subpixel shifts) doesn't fail the test. A real layout regression moves far
  // more than this many pixels.
  await expect(page).toHaveScreenshot('demo-page.png', {
    fullPage: true,
    maxDiffPixels: 100,
  });
});