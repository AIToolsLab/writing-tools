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

test('editor.html device-auth screen shows a styled "Open approval page" button', async ({
  page,
}) => {
  // Freeze time so the live countdown (CodeCountdown, ticking via setInterval)
  // renders a fixed "Code expires in 10:00" instead of a value that drifts with
  // however long the test takes to run.
  await page.clock.install({ time: new Date('2024-01-01T00:00:00Z') });

  await page.addInitScript(() => {
    window.localStorage.setItem('hasCompletedOnboarding', 'true');
  });

  // Stand in for the device-authorization endpoints (src/api/deviceAuth.ts) so
  // clicking Login reaches the "polling" state without a real backend.
  await page.route('**/auth/device/code', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        device_code: 'mock-device-code',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://example.com/device',
        expires_in: 600,
        interval: 5,
      }),
    });
  });
  // Never resolves — keeps the UI in the "polling" state for the screenshot.
  await page.route('**/auth/device/token', async (route) => {
    await route.fulfill({
      status: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'authorization_pending' }),
    });
  });

  await page.goto('/editor.html');
  await page.getByRole('button', { name: 'Login' }).click();

  const approvalLink = page.getByRole('link', { name: 'Open approval page' });
  await expect(approvalLink).toBeVisible();
  await expect(approvalLink).toHaveAttribute(
    'href',
    'https://example.com/device',
  );
  await expect(page.getByText('Code expires in 10:00')).toBeVisible();

  await expect(page).toHaveScreenshot('editor-login-device-code.png', {
    fullPage: true,
  });
});
