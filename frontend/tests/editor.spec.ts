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

test('Rewording without a selection prompts the user to select text', async ({ page }) => {
  // Rewording short-circuits before any backend call when no text is selected
  // (draft/index.tsx), so this needs no mock backend.
  await page.locator('button[aria-label="Rewording"]').click();
  await expect(
    page.getByText('Please select some text to get rewording suggestions'),
  ).toBeVisible();
});

test('Revise shows an empty-document message when nothing is written', async ({ page }) => {
  // No text was typed in beforeEach, so the document is empty.
  await page.locator('button', { hasText: 'Revise' }).click();
  await expect(page.getByText('The document seems to be empty')).toBeVisible();
});

test('Chat send button is disabled until the input has text', async ({ page }) => {
  await page.locator('button', { hasText: 'Chat' }).click();

  const input = page.locator('textarea[placeholder*="Ask"]');
  const sendButton = page.locator('button[title="Send message"]');

  await expect(input).toBeVisible();
  await expect(sendButton).toBeDisabled();

  await input.fill('What is my main argument?');
  await expect(sendButton).toBeEnabled();

  // Clearing the input disables the button again.
  await input.fill('');
  await expect(sendButton).toBeDisabled();
});

test('word count updates as text is typed', async ({ page }) => {
  // Demo mode shows a "Words: N" counter next to the editor.
  await expect(page.getByText('Words: 0')).toBeVisible();

  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially('one two three');

  await expect(page.getByText('Words: 3')).toBeVisible();
});

test('Chat welcome screen shows the suggestion chips', async ({ page }) => {
  await page.locator('button', { hasText: 'Chat' }).click();

  for (const prompt of [
    'What is my main argument?',
    'How can I improve clarity?',
    'Is my structure logical?',
    'What am I missing?',
  ]) {
    await expect(page.getByRole('button', { name: prompt })).toBeVisible();
  }
});

test('Revise Run button enables only after a feature is selected', async ({ page }) => {
  // Revise needs a non-empty document to show its feature list.
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially('Some text to analyze');

  await page.locator('button', { hasText: 'Revise' }).click();

  const runButton = page.getByRole('button', { name: /Run/ });
  await expect(runButton).toBeDisabled();

  await page.locator('button', { hasText: 'Hierarchical Outline' }).click();
  await expect(runButton).toBeEnabled();
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
