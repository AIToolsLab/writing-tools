import { test, expect } from '@playwright/test';
import { setupMockBackend } from './mockBackend';

test('demo page - visual regression', async ({ page }) => {
  // Setup mock backend with actual API structure
  await setupMockBackend(page);

  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('Thoughtful');

  // The baseline is captured on one OS but CI renders on Linux; font
  // antialiasing/hinting differs across OSes and shifts ~1% of pixels even when
  // the layout is identical. Allow 2% so that cross-OS rendering noise passes
  // while a real layout regression (which moves far more, and also changes the
  // image dimensions) still fails.
  await expect(page).toHaveScreenshot('demo-page.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.02,
  });
});