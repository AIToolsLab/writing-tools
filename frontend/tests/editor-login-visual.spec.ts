import { test, expect } from '@playwright/test';

// editor.html defaults to OverallMode.full (real auth), so with no persisted
// token it lands on the "Not logged in yet?" screen instead of the demo editor.
// No backend mocking needed: useDeviceAuth only calls out when a token is in
// localStorage (see src/hooks/useDeviceAuth.ts hydrate effect), and there isn't one.
test('editor.html shows the login screen — visual regression', async ({ page }) => {
  // Skip the onboarding carousel so the login screen renders directly.
  await page.addInitScript(() => {
    window.localStorage.setItem('hasCompletedOnboarding', 'true');
  });

  await page.goto('/editor.html');

  await expect(page.getByText('Not logged in yet?')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();

  await expect(page).toHaveScreenshot('editor-login.png', {
    fullPage: true,
  });
});
