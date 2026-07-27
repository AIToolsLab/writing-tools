import { test, expect } from '@playwright/test';
import {
  QUOTA_ERROR_MESSAGE,
  fulfillOpenAIStreamError,
  setupMockBackend,
} from './mockBackend';

/**
 * A failed generation must never look like an empty result.
 *
 * Each test drives one page with the model failing the way it does in
 * production — HTTP 200, then an `error` event mid-SSE-stream — and asserts the
 * writer is told, rather than left with a blank panel, a stuck spinner, or
 * "No suggestions yet".
 */
test.beforeEach(async ({ page }) => {
  await setupMockBackend(page);
  // Override the success route registered above: later routes win in Playwright.
  await page.route('**/openai/responses', fulfillOpenAIStreamError);
  await page.goto('/editor.html?page=demo');
  await expect(page.locator('button[aria-label="Examples"]')).toBeVisible({
    timeout: 15000,
  });
});

test('Draft: a quota failure is reported instead of "No suggestions yet"', async ({
  page,
}) => {
  await page.locator('button[aria-label="Examples"]').click();

  const notice = page.getByRole('alert');
  await expect(notice).toBeVisible({ timeout: 10000 });
  await expect(notice).toContainText(/out of credit/i);
  await expect(page.getByText('No suggestions yet')).toBeHidden();

  // The provider's own words stay available for a bug report, but only on request.
  await expect(page.getByText(QUOTA_ERROR_MESSAGE)).toBeHidden();
  await notice.getByRole('button', { name: 'Technical details' }).click();
  await expect(page.getByText(QUOTA_ERROR_MESSAGE)).toBeVisible();
});

test('Revise: the failing feature says so', async ({ page }) => {
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially('Some text to analyze');

  await page.locator('button', { hasText: 'Revise' }).click();
  await page.locator('button', { hasText: 'Hierarchical Outline' }).click();
  await page.locator('button', { hasText: /^Run / }).click();

  const notice = page.getByRole('alert');
  await expect(notice).toBeVisible({ timeout: 10000 });
  await expect(notice).toContainText('Hierarchical Outline failed');
  await expect(notice).toContainText(/out of credit/i);
});

test('Chat: a failed reply is reported and the message is handed back', async ({
  page,
}) => {
  await page.locator('button', { hasText: 'Chat' }).click();

  const input = page.locator('textarea[placeholder*="Ask"]');
  await input.fill('Is the tone consistent?');
  await page.locator('button[title="Send message"]').click();

  const notice = page.getByRole('alert');
  await expect(notice).toBeVisible({ timeout: 10000 });
  await expect(notice).toContainText(/out of credit/i);
  // The turn was rolled back, so the message is back in the box, not stranded
  // above an empty assistant bubble.
  await expect(input).toHaveValue('Is the tone consistent?');
});
