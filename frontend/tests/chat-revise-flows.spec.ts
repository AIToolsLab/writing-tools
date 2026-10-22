import { test, expect } from '@playwright/test';
import { fulfillOpenAI, setupMockBackend } from './mockBackend';

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

// A reply that uses the markdown the model actually reaches for: a GFM table
// (which plain CommonMark doesn't parse at all) and a bulleted list (whose
// marker and indent Tailwind's preflight strips).
const MARKDOWN_REPLY = [
  '| Section | Verdict |',
  '| --- | --- |',
  '| Opening | Clear |',
  '| Middle | Needs work |',
  '',
  '- Tighten the middle',
  '- Keep the opening',
].join('\n');

test('Chat: an assistant reply renders markdown tables and lists', async ({
  page,
}) => {
  // Later routes win in Playwright, so this replaces setupMockBackend's.
  await page.route('**/openai/responses', async (route) => {
    await fulfillOpenAI(route, MARKDOWN_REPLY);
  });

  await page.locator('button', { hasText: 'Chat' }).click();
  const input = page.locator('textarea[placeholder*="Ask"]');
  await input.fill('How does the structure look?');
  await page.locator('button[title="Send message"]').click();

  // A real table, not the literal pipe characters CommonMark leaves behind.
  const table = page.locator('[class*="chatBubble"] table');
  await expect(table).toBeVisible({ timeout: 5000 });
  await expect(table.locator('th', { hasText: 'Verdict' })).toBeVisible();
  await expect(table.locator('td', { hasText: 'Needs work' })).toBeVisible();
  // It scrolls on its own rather than widening the transcript.
  await expect(page.locator('[class*="tableWrap"]')).toHaveCSS(
    'overflow-x',
    'auto',
  );

  // List items keep their marker and indent through Tailwind's reset.
  const firstItem = page.locator('[class*="chatBubble"] ul > li').first();
  await expect(firstItem).toHaveText('Tighten the middle');
  await expect(firstItem.locator('xpath=..')).toHaveCSS(
    'list-style-type',
    'disc',
  );
  const indent = await firstItem
    .locator('xpath=..')
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(indent).toBeGreaterThan(0);
});

test('Chat: a doctext citation in a reply jumps to the document', async ({
  page,
}) => {
  await page.route('**/openai/responses', (route) =>
    fulfillOpenAI(
      route,
      'Look at [your opening line](doctext:Some%20text%20to%20analyze) again.',
    ),
  );

  // Give the reply something real to point at.
  const editor = page.locator('[contenteditable="true"]');
  await editor.click();
  await editor.pressSequentially('Some text to analyze');

  await page.locator('button', { hasText: 'Chat' }).click();
  await page.locator('textarea[placeholder*="Ask"]').fill('Where should I look?');
  await page.locator('button[title="Send message"]').click();

  // The `doctext:` scheme survives React Markdown's URL filter...
  const citation = page.locator('[class*="chatBubble"] a', {
    hasText: 'your opening line',
  });
  await expect(citation).toHaveAttribute(
    'href',
    'doctext:Some%20text%20to%20analyze',
    { timeout: 5000 },
  );

  // ...and clicking it selects the quoted text, same as on Revise.
  await citation.click();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('Some text to analyze');
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

  // Citations link into the document with a `doctext:` URL. React Markdown
  // blanks out any scheme outside its safe list by default, which would leave
  // the writer clicking links that do nothing, so pin that the exemption holds
  // in a real build.
  const citation = page.locator('a', { hasText: 'opening line' });
  await expect(citation).toHaveAttribute(
    'href',
    'doctext:Some%20text%20to%20analyze',
  );

  // And that clicking one still selects the quoted text in the document.
  await citation.click();
  await expect
    .poll(() => page.evaluate(() => window.getSelection()?.toString() ?? ''))
    .toBe('Some text to analyze');
});
