import { expect, test } from '@playwright/test';
import { setupMockBackend } from './mockBackend';

/**
 * End-to-end for the Partners lab page — the reproduction of arXiv:2609.01588
 * (see `docs/proactive-partners-reproduction.md`).
 *
 * The point of driving this in a browser rather than unit-testing it: the whole
 * question the reproduction turns on is whether the paper's triggers can be
 * recovered from *polling the host* instead of from keystrokes. `signals.ts`
 * has tests that prove the state machine, but they feed it snapshots directly.
 * Only a real editor with a real poll loop shows whether the writer typing and
 * then stopping actually produces a partner.
 */

/** Configure one partner through the panel, as a writer would. */
async function addPartner(
	page: import('@playwright/test').Page,
	{
		name,
		role,
		heuristic,
		trigger,
	}: { name: string; role: string; heuristic: string; trigger: string },
) {
	await page.getByRole('button', { name: 'Add a partner' }).click();
	await page.getByLabel('Partner name').fill(name);
	await page.getByLabel('What kind of help?').fill(role);
	await page.getByRole('checkbox', { name: new RegExp(trigger) }).check();
	await page.getByLabel('Condition for stepping in').fill(heuristic);
}

test.beforeEach(async ({ page }) => {
	await setupMockBackend(page);
	await page.goto('/editor.html?page=demo');
	await expect(page.locator('button[aria-label="Examples"]')).toBeVisible({
		timeout: 15000,
	});
	await page.locator('button[aria-label="Experimental pages"]').click();
	await page.getByRole('menuitem', { name: /Partners/ }).click();
	await expect(page.getByText('Your partners')).toBeVisible();
});

test('watching cannot be switched on until a partner is complete', async ({
	page,
}) => {
	const watch = page.getByRole('checkbox', { name: /Watch while I write/ });
	await expect(watch).toBeDisabled();
	await expect(page.getByText('Add a partner below first.')).toBeVisible();
});

test('a half-configured partner still does not enable watching', async ({
	page,
}) => {
	// The paper leaves triggers unselected by default; a partner with a name and
	// a role but no trigger has no moment to act at, so it must not count.
	await page.getByRole('button', { name: 'Add a partner' }).click();
	await page.getByLabel('Partner name').fill('Evidence');
	await page.getByLabel('What kind of help?').fill('Help me support claims.');
	await expect(
		page.getByRole('checkbox', { name: /Watch while I write/ }),
	).toBeDisabled();
	await expect(page.getByText('not yet active')).toBeVisible();
});

test('a partner activates after the writer pauses, and can be opened', async ({
	page,
}) => {
	test.setTimeout(60_000);

	await addPartner(page, {
		name: 'Evidence',
		role: 'Notice claims that lack support.',
		heuristic: 'When I make a claim with no example near it.',
		trigger: 'Long pause',
	});

	const watch = page.getByRole('checkbox', { name: /Watch while I write/ });
	await expect(watch).toBeEnabled();
	await watch.check();
	await expect(page.getByText(/partner watching for/)).toBeVisible();

	// Type, then stop. The pause trigger needs 5s of stillness, and the poll
	// interval quantises detection on top of that (challenge C2).
	const editor = page.locator('[contenteditable="true"]');
	await editor.click();
	await editor.pressSequentially(
		'Elite players win because of their training habits.',
	);

	const tag = page.getByRole('button', {
		name: 'Evidence has a suggestion — open it',
	});
	await expect(tag).toBeVisible({ timeout: 30_000 });

	// Clicking the tag is what asks for the suggestion — it is not generated
	// until then (challenge C5).
	await tag.click();
	await expect(
		page.getByText('You have just stated a claim about training habits.'),
	).toBeVisible({ timeout: 20_000 });
	await expect(
		page.getByText('What would a reader need to see to believe it?'),
	).toBeVisible();

	// The follow-up conversation of §4.4.
	await page.getByLabel('Reply to Evidence').fill('Why does that matter?');
	await page.getByRole('button', { name: 'Send' }).click();
	await expect(
		page.getByText('A mock follow-up reply from the partner.'),
	).toBeVisible({ timeout: 20_000 });

	// The card carries no way to write into the document — the paper's third
	// engagement form is deliberately absent (challenge C4).
	await expect(page.getByRole('button', { name: /Help me write/i })).toHaveCount(
		0,
	);
});

test('nothing is watched while the toggle is off', async ({ page }) => {
	let requests = 0;
	await page.route('**/openai/responses', async (route) => {
		requests += 1;
		await route.fallback();
	});

	await addPartner(page, {
		name: 'Evidence',
		role: 'Notice claims that lack support.',
		heuristic: 'When I make a claim with no example near it.',
		trigger: 'Long pause',
	});

	const editor = page.locator('[contenteditable="true"]');
	await editor.click();
	await editor.pressSequentially('A claim with no support at all.');
	await page.waitForTimeout(10_000);

	expect(requests).toBe(0);
});
