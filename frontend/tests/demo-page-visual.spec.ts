import { test, expect } from '@playwright/test';

test('demo page - visual regression', async ({ page }) => {
  // Intercept API calls and return mocked responses
  await page.route('/api/**', async route => {
    await route.fulfill({
      status: 200,
      body: JSON.stringify({ message: 'mocked' })
    });
  });

  await page.goto('/');

  page.frameLocator('#editor-frame').locator('body').waitFor()

  await expect(page.getByRole('banner')).toContainText('Thoughtful');

  await expect(page).toHaveScreenshot('demo-page.png', {
    fullPage: true
  });
});