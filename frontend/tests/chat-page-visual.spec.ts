import { test, expect } from '@playwright/test';
import { fulfillOpenAI, setupMockBackend } from './mockBackend';

/**
 * Visual regression for the Chat page, in both states it can be in: the empty
 * welcome screen (title + suggestion chips, no toolbar) and a settled
 * conversation (two user turns, two assistant replies, "New conversation").
 *
 * Both run on the standalone editor's demo page with an untouched document, so
 * the only thing that varies between the two snapshots is the chat panel.
 */

const FIRST_PROMPT = 'What is my main argument?';
const SECOND_PROMPT = 'Is the tone consistent?';

// Distinct per-turn replies, so the transcript snapshot shows two different
// bubbles rather than the same sentence twice. The second is markdown, which
// covers the Remark rendering path (a list) that plain text doesn't.
// Both are short so the four bubbles nearly fill the chat body rather than
// overflowing it far enough to push the first turn out of the snapshot.
const FIRST_REPLY = 'The document is empty, so there is no argument yet.';
const SECOND_REPLY =
	'- Who is your reader?\n- How formal should you sound to them?';

test.beforeEach(async ({ page }) => {
	await setupMockBackend(page);

	// Override the shared chat reply with a per-turn one. Later routes win in
	// Playwright, so this replaces the route setupMockBackend registered.
	await page.route('**/openai/responses', async (route) => {
		const body = route.request().postDataJSON() as {
			input?: Array<{ content?: string | Array<{ text?: string }> }>;
		};
		// Flatten the turns; the request carries every message sent so far, so the
		// second prompt's presence is what distinguishes turn two from turn one.
		const text = JSON.stringify(body.input ?? []);
		await fulfillOpenAI(
			route,
			text.includes(SECOND_PROMPT) ? SECOND_REPLY : FIRST_REPLY,
		);
	});

	await page.goto('/editor.html?page=demo');
	// Draft is the default page — wait for it to confirm the app has loaded.
	await expect(page.locator('button[aria-label="Examples"]')).toBeVisible({
		timeout: 15000,
	});
	await page.locator('button', { hasText: 'Chat' }).click();
});

test('Chat: the starting page — visual regression', async ({ page }) => {
	await expect(
		page.getByText('What do you think about your document so far?'),
	).toBeVisible();
	// All four suggestion chips, so the snapshot isn't taken mid-render.
	await expect(
		page.locator('button', { hasText: FIRST_PROMPT }),
	).toBeVisible();
	await expect(
		page.locator('button', { hasText: 'What am I missing?' }),
	).toBeVisible();

	await expect(page).toHaveScreenshot('chat-start.png', {
		fullPage: true,
	});
});

test('Chat: a two-turn conversation — visual regression', async ({ page }) => {
	// Turn one via a suggestion chip; turn two via the input box, so the snapshot
	// covers both ways in.
	await page.locator('button', { hasText: FIRST_PROMPT }).click();
	await expect(page.getByText(FIRST_REPLY)).toBeVisible({ timeout: 5000 });

	const input = page.locator('textarea[placeholder*="Ask"]');
	await input.fill(SECOND_PROMPT);
	await page.locator('button[title="Send message"]').click();
	await expect(
		page.getByText('How formal should you sound to them?'),
	).toBeVisible({ timeout: 5000 });

	// The typing indicator animates while a reply is in flight; the input is
	// re-enabled only once the stream finishes, so this settles the transcript.
	await expect(input).toBeEnabled();

	// Pin the transcript to the bottom, and keep pinning until it stays there.
	// The page's own auto-scroll is smooth and fires before react-remark has
	// finished rendering the markdown, so the resting offset of a transcript
	// that overflows is a race — one a pixel comparison reads as a diff. A
	// scrollTop assignment aborts any smooth scroll still in flight, and the
	// poll re-pins if late-rendered markdown grows the content underneath it.
	const chatBody = page.locator('[class*="chatBody"]');
	await expect
		.poll(() =>
			chatBody.evaluate((el) => {
				el.scrollTop = el.scrollHeight;
				return el.scrollHeight - el.clientHeight - el.scrollTop;
			}),
		)
		.toBe(0);

	await expect(page).toHaveScreenshot('chat-two-turns.png', {
		fullPage: true,
	});
});
