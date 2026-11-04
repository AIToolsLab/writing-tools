import { test, expect } from '@playwright/test';
import { setupMockBackend, fulfillOpenAI } from './mockBackend';

test.describe('Draft component - Main flows', () => {
  test.beforeEach(async ({ page }) => {
    // Setup mock backend with actual API structure
    await setupMockBackend(page);

    // Navigate to the draft page
    await page.goto('/');

    // Wait for page to be ready
    await expect(page.getByRole('banner')).toContainText('Thoughtful');
  });

const readerLocator = 'button[title="What might a reader ask?"]';
const adviceLocator = 'button[title="What might a writing coach suggest?"]';

  test('should display the two generation option buttons', async ({ page }) => {
    // Locate the draft iframe
    const frame = page.frameLocator('#editor-frame');

    // Verify both generation buttons are present using title attribute
    await expect(frame.locator(readerLocator)).toBeVisible();
    await expect(frame.locator(adviceLocator)).toBeVisible();
    // Rewording is behind the `rewording` feature flag (see editor.spec.ts).
    await expect(frame.locator('button[aria-label="Rewording"]')).toHaveCount(0);
  });

  test('should generate and display reader perspective when clicking reader button', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');
    const readerButton = frame.locator(readerLocator);

    // Click the reader perspective button
    await readerButton.click();

    // Wait for and verify suggestions are displayed
    await expect(frame.getByText('First reader perspective')).toBeVisible({ timeout: 5000 });
    await expect(frame.getByText('Second reader perspective')).toBeVisible();
    await expect(frame.getByText('Third reader perspective')).toBeVisible();
  });

  test('should generate and display advice when clicking advice button', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');
    const adviceButton = frame.locator(adviceLocator);

    // Click the advice button
    await adviceButton.click();

    // Wait for and verify suggestions are displayed
    await expect(frame.getByText('First piece of advice')).toBeVisible({ timeout: 5000 });
    await expect(frame.getByText('Second piece of advice')).toBeVisible();
    await expect(frame.getByText('Third piece of advice')).toBeVisible();
  });

  test('should delete suggestion when clicking delete button', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');
    const readerButton = frame.locator(readerLocator);
    const adviceButton = frame.locator(adviceLocator);

    // Generate reader perspective suggestion
    await readerButton.click();
    await expect(frame.getByText('First reader perspective')).toBeVisible({ timeout: 5000 });

    // Delete reader perspective suggestion
    const deleteButton1 = frame.locator('button[aria-label="Delete suggestion"]').first();
    await deleteButton1.click();
    await expect(frame.getByText('First reader perspective')).not.toBeVisible({ timeout: 2000 });

    // Generate advice suggestion
    await adviceButton.click();
    await expect(frame.getByText('First piece of advice')).toBeVisible({ timeout: 5000 });

    // Delete advice suggestion
    const deleteButton2 = frame.locator('button[aria-label="Delete suggestion"]').first();
    await deleteButton2.click();
    await expect(frame.getByText('First piece of advice')).not.toBeVisible({ timeout: 2000 });
  });

  test('should disable buttons during loading', async ({ page }) => {
  const frame = page.frameLocator('#editor-frame');
  const readerButton = frame.locator(readerLocator);
  const adviceButton = frame.locator(adviceLocator);

  // Mock backend with delay and realistic streamed response
  await page.route('**/openai/responses', async (route) => {
    await page.waitForTimeout(1000); // simulate network delay
    await fulfillOpenAI(
      route,
      '- First reader perspective\n\n- Second reader perspective\n\n- Third reader perspective'
    );
  });

  // Click the button to trigger request
  await readerButton.click();

  // Immediately check that all buttons are disabled
  await expect(readerButton).toBeDisabled();
  await expect(adviceButton).toBeDisabled();

  // Wait for the UI to render the first suggestion
  await expect(frame.locator('text=First reader perspective')).toBeVisible();

  // Verify buttons are enabled again
  await expect(readerButton).toBeEnabled();
  await expect(adviceButton).toBeEnabled();
});

  test('should display empty state message when no suggestions generated', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');

    // Verify empty state message is shown
    await expect(frame.getByText('No suggestions yet')).toBeVisible();
  });

});
