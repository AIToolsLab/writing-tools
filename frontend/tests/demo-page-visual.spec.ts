import { test, expect } from '@playwright/test';
import { setupMockBackend } from './mockBackend';

test('demo page - visual regression', async ({ page }) => {
  // Setup mock backend with actual API structure
  await setupMockBackend(page);

  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('Thoughtful');

  await expect(page).toHaveScreenshot('demo-page.png', {
    fullPage: true
  });
});