import { test, expect } from '@playwright/test';

test('demo page - visual regression', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('/');

  await expect(page.getByRole('banner')).toContainText('Thoughtful');

  await expect(page).toHaveScreenshot('demo-page.png', {
    fullPage: true
  });
});