import { test, expect } from '@playwright/test';
import { setupMockBackend } from './mockBackend';

// Mock-backed E2E for the Chat and Revise pages on the standalone editor.
// These exercise a full request/response round trip against the mocked
// OpenAI-compatible endpoint (see mockBackend.ts), so they need no real backend.
test.beforeEach(async ({ page }) => {
  await setupMockBackend(page);
  await page.goto('/editor.html?page=demo');
  // Draft is the default page — wait for it to confirm the app has loaded.
  await expect(page.locator('button[aria-label="Examples"]')).toBeVisible({
    timeout: 15000,
  });
});

test('Chat: sending a message shows the user message and the assistant reply', async ({
  page,
}) => {
  await page.locator('button', { hasText: 'Chat' }).click();

  const input = page.locator('textarea[placeholder*="Ask"]');
  // Use a message that is NOT one of the suggestion chips, so the assertion
  // can't accidentally match the welcome screen.
  await input.fill('Is the tone consistent?');
  await page.locator('button[title="Send message"]').click();

  // The user's message is echoed into the conversation.
  await expect(page.getByText('Is the tone consistent?')).toBeVisible();
  // The mocked assistant reply streams in.
  await expect(
    page.getByText('This is a mock assistant reply about your document.'),
  ).toBeVisible({ timeout: 5000 });
});

test('Revise: running a selected feature shows a result', async ({ page }) => {
  // Type something so Revise isn't in its empty-document state.
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially('Some text to analyze');

  await page.locator('button', { hasText: 'Revise' }).click();

  // Select a feature, then run it via the sticky footer button.
  await page.locator('button', { hasText: 'Hierarchical Outline' }).click();
  await page.locator('button', { hasText: /^Run / }).click();

  // The mocked visualization result is rendered.
  await expect(
    page.getByText('A mock structural observation about your document.'),
  ).toBeVisible({ timeout: 5000 });
});
