import { test, expect } from '@playwright/test';
import { setupMockBackend } from './mockBackend';

test.describe('Draft component - Main flows', () => {
  test.beforeEach(async ({ page }) => {
    // Setup mock backend with actual API structure
    await setupMockBackend(page);

    // Navigate to the draft page
    await page.goto('/');

    // Wait for page to be ready
    await expect(page.getByRole('banner')).toContainText('Thoughtful');
  });

  test('should display three generation option buttons', async ({ page }) => {
    // Locate the draft iframe
    const frame = page.frameLocator('#editor-frame');

    // Verify all three generation buttons are present using title attribute
    const exampleButton = frame.locator('button[title="Examples of what you could write next:"]');
    const readerButton = frame.locator('button[title="Possible questions your reader might have:"]');
    const adviceButton = frame.locator('button[title="Advice for your next words:"]');

    await expect(exampleButton).toBeVisible();
    await expect(readerButton).toBeVisible();
    await expect(adviceButton).toBeVisible();
  });

  test('should generate and display example sentences when clicking example button', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');
    const exampleButton = frame.locator('button[title="Examples of what you could write next:"]');

    // Click the example sentences button
    await exampleButton.click();

    // Wait for and verify suggestions are displayed
    await expect(frame.getByText('First example suggestion')).toBeVisible({ timeout: 5000 });
    await expect(frame.getByText('Second example suggestion')).toBeVisible();
    await expect(frame.getByText('Third example suggestion')).toBeVisible();
  });

  test('should generate and display reader perspective when clicking reader button', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');
    const readerButton = frame.locator('button[title="Possible questions your reader might have:"]');

    // Click the reader perspective button
    await readerButton.click();

    // Wait for and verify suggestions are displayed
    await expect(frame.getByText('First reader perspective')).toBeVisible({ timeout: 5000 });
    await expect(frame.getByText('Second reader perspective')).toBeVisible();
    await expect(frame.getByText('Third reader perspective')).toBeVisible();
  });

  test('should generate and display advice when clicking advice button', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');
    const adviceButton = frame.locator('button[title="Advice for your next words:"]');

    // Click the advice button
    await adviceButton.click();

    // Wait for and verify suggestions are displayed
    await expect(frame.getByText('First piece of advice')).toBeVisible({ timeout: 5000 });
    await expect(frame.getByText('Second piece of advice')).toBeVisible();
    await expect(frame.getByText('Third piece of advice')).toBeVisible();
  });

  test('should delete suggestion when clicking delete button', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');
    const exampleButton = frame.locator('button[title="Examples of what you could write next:"]');
    const readerButton = frame.locator('button[title="Possible questions your reader might have:"]');
    const adviceButton = frame.locator('button[title="Advice for your next words:"]');

    // Generate example suggestion
    await exampleButton.click();
    await expect(frame.getByText('First example suggestion')).toBeVisible({ timeout: 5000 });

    // Delete example suggestion
    const deleteButton1 = frame.locator('button[aria-label="Delete saved item"]').first();
    await deleteButton1.click();
    await expect(frame.getByText('First example suggestion')).not.toBeVisible({ timeout: 2000 });

    // Generate reader perspective suggestion
    await readerButton.click();
    await expect(frame.getByText('First reader perspective')).toBeVisible({ timeout: 5000 });

    // Delete reader perspective suggestion
    const deleteButton2 = frame.locator('button[aria-label="Delete saved item"]').first();
    await deleteButton2.click();
    await expect(frame.getByText('First reader perspective')).not.toBeVisible({ timeout: 2000 });

    // Generate advice suggestion
    await adviceButton.click();
    await expect(frame.getByText('First piece of advice')).toBeVisible({ timeout: 5000 });

    // Delete advice suggestion
    const deleteButton3 = frame.locator('button[aria-label="Delete saved item"]').first();
    await deleteButton3.click();
    await expect(frame.getByText('First piece of advice')).not.toBeVisible({ timeout: 2000 });
  });

  test('should disable buttons during loading', async ({ page }) => {
  const frame = page.frameLocator('#editor-frame');
  const exampleButton = frame.locator('button[title="Examples of what you could write next:"]');
  const readerButton = frame.locator('button[title="Possible questions your reader might have:"]');
  const adviceButton = frame.locator('button[title="Advice for your next words:"]');

  // Mock backend with delay and realistic response
  await page.route('**/api/get_suggestion*', async (route) => {
    await page.waitForTimeout(1000); // simulate network delay
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        result: '- First example suggestion\n\n- Second example suggestion\n\n- Third example suggestion'
      }),
    });
  });

  // Click the button to trigger request
  await exampleButton.click();

  // Immediately check that all buttons are disabled
  await expect(exampleButton).toBeDisabled();
  await expect(readerButton).toBeDisabled();
  await expect(adviceButton).toBeDisabled();

  // Wait for the UI to render the first suggestion
  await expect(frame.locator('text=First example suggestion')).toBeVisible();

  // Verify buttons are enabled again
  await expect(exampleButton).toBeEnabled();
  await expect(readerButton).toBeEnabled();
  await expect(adviceButton).toBeEnabled();
});

  test('should display empty state message when no suggestions generated', async ({ page }) => {
    const frame = page.frameLocator('#editor-frame');

    // Verify empty state message is shown
    await expect(frame.getByText('Click the button above to generate a suggestion.')).toBeVisible();
  });

});
