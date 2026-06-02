import { test, expect } from '@playwright/test';

// All tests target editor.html?page=demo which requires no login.
test.beforeEach(async ({ page }) => {
  await page.goto('/editor.html?page=demo');
  // Draft is the default page — wait for it to confirm the app has loaded
  await expect(page.locator('button[aria-label="Examples"]')).toBeVisible({ timeout: 15000 });
});

test('editor loads and text area is visible', async ({ page }) => {
  // The Lexical editor renders as a contenteditable div
  await expect(page.locator('[contenteditable="true"]')).toBeVisible();
});

test('can type text into the editor', async ({ page }) => {
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially('Hello world');
  await expect(editor).toContainText('Hello world');
});

test('Draft page shows four suggestion buttons', async ({ page }) => {
  await expect(page.locator('button[aria-label="Examples"]')).toBeVisible();
  await expect(page.locator('button[aria-label="Questions"]')).toBeVisible();
  await expect(page.locator('button[aria-label="Advice"]')).toBeVisible();
  await expect(page.locator('button[aria-label="Rewording"]')).toBeVisible();
});

test('can switch to Revise page and see Document structure section', async ({ page }) => {
  // Revise page shows empty state when the editor has no content, so type something first
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially('Some text to analyze');

  await page.locator('button', { hasText: 'Revise' }).click();
  await expect(page.getByText('Document structure')).toBeVisible();
});

test('can switch to Chat page and see message input', async ({ page }) => {
  await page.locator('button', { hasText: 'Chat' }).click();
  await expect(page.locator('textarea[placeholder*="Ask"]')).toBeVisible();
});

test('can navigate between all three tabs', async ({ page }) => {
  // Start on Draft (default)
  await expect(page.locator('button[aria-label="Examples"]')).toBeVisible();

  // Type something first so Revise page doesn't show the empty-document message
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially('Some text');

  // Go to Revise
  await page.locator('button', { hasText: 'Revise' }).click();
  await expect(page.getByText('Document structure')).toBeVisible();

  // Go to Chat
  await page.locator('button', { hasText: 'Chat' }).click();
  await expect(page.locator('textarea[placeholder*="Ask"]')).toBeVisible();

  // Go back to Draft
  await page.locator('button', { hasText: 'Draft' }).click();
  await expect(page.locator('button[aria-label="Examples"]')).toBeVisible();
});
