import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect, Page } from '@playwright/test';
import {
	fulfillOpenAI,
	setupMockBackend,
	setupSignedInUser,
	waitForEditorReady,
} from './mockBackend';

/**
 * The app fills its mount point and scrolls inside its pages — which only works
 * if every surface gives that mount point a definite height (see the comment on
 * the app root in src/pages/app/index.tsx). When one doesn't, nothing looks
 * wrong until content overflows: then the app grows with it, the document
 * scrolls instead of the page, the navbar and pinned footers scroll away, and
 * where scrollbars aren't overlays one eats 15px of the 300px Google Docs
 * sidebar. Headless Chromium hides scrollbars, so a screenshot can't show it;
 * this measures the layout instead, with enough model output to overflow.
 */

// Enough output to overflow any page at the heights used below.
const LONG_REPLY = Array(20)
	.fill(
		'- A fairly long line of model output that wraps a few times in a narrow sidebar.',
	)
	.join('\n');

/**
 * The content overflowed, so something inside the app must be scrolling it.
 *
 * Comparing the app's height to its pane's doesn't work: a pane with only
 * `min-height` grows along with the app, so the two stay equal while the bug is
 * present. What differs is where the overflow goes — into a scroller inside the
 * app when the pane is definite, outward (pane and app both grow) when it isn't.
 */
async function expectAppFillsPane(
	page: Page,
	{ documentMayScroll = false } = {},
) {
	const m = await page.getByTestId('app-root').evaluate((app) => ({
		scrollingInside: [app, ...app.querySelectorAll('*')].some((el) => {
			// A textarea scrolls its own text (the chat composer's wrapped
			// placeholder overflows at 300px) — not the page's content.
			if (el instanceof HTMLTextAreaElement) return false;
			const { overflowY } = getComputedStyle(el);
			return (
				/auto|scroll/.test(overflowY) &&
				el.scrollHeight > el.clientHeight + 1
			);
		}),
		documentOverflow:
			document.documentElement.scrollHeight - window.innerHeight,
	}));
	expect(
		m.scrollingInside,
		'overflowing content should scroll inside the app — if nothing does, the app grew with it, so its mount point has no definite height',
	).toBe(true);
	if (!documentMayScroll) expect(m.documentOverflow).toBeLessThanOrEqual(0);
}

test.describe('Google Docs sidebar', () => {
	// Production bundle host that sidebar.html loads from (SOURCES.prod there).
	const PROD = 'https://app.thoughtful-ai.com';
	const dist = (file: string) => path.join(__dirname, '..', 'dist', file);

	test.beforeEach(async ({ page }) => {
		// Nothing may reach production. Registered first so every later, more
		// specific route (bundle files, setupMockBackend's API mocks) wins.
		await page.route(`${PROD}/**`, (route) => route.abort());
		await page.route(`${PROD}/google-docs.bundle.js`, (route) =>
			route.fulfill({ path: dist('google-docs.bundle.js') }),
		);
		await page.route(`${PROD}/google-docs.css`, (route) =>
			route.fulfill({ path: dist('google-docs.css') }),
		);
		await setupMockBackend(page);
		await setupSignedInUser(page);
		await page.route('**/openai/responses', (route) =>
			fulfillOpenAI(route, LONG_REPLY),
		);

		// The real sidebar.html, so its CSS and its google.script.run bridge are
		// what's under test, served at a local URL.
		const sidebarHtml = readFileSync(
			path.join(
				__dirname,
				'..',
				'..',
				'google-docs-addon',
				'sidebar.html',
			),
			'utf8',
		);
		await page.route('**/google-docs-sidebar.html', (route) =>
			route.fulfill({ contentType: 'text/html', body: sidebarHtml }),
		);

		// Stand-in for Apps Script's google.script.run:
		// run.withSuccessHandler(ok).withFailureHandler(fail)[fn](...args).
		await page.addInitScript(() => {
			const results: Record<string, unknown> = {
				// Not "[dev]", so sidebar.html loads the prod bundle (routed above).
				getDocumentName: 'Test document',
				getDocContext: {
					beforeCursor:
						'An opening paragraph about the topic. '.repeat(20),
					selectedText: '',
					afterCursor: '',
				},
				getAllTabs: [],
			};
			const call = (ok: (r: unknown) => void) =>
				new Proxy(
					{},
					{
						get: (_, fn: string) => () =>
							setTimeout(() => ok(results[fn] ?? null), 0),
					},
				);
			(window as unknown as { google: unknown }).google = {
				script: {
					run: {
						withSuccessHandler: (ok: (r: unknown) => void) => ({
							withFailureHandler: () => call(ok),
						}),
					},
				},
			};
		});

		// The sidebar's real width; short, so modest output overflows.
		await page.setViewportSize({ width: 300, height: 500 });
		await page.goto('/google-docs-sidebar.html');
		await waitForEditorReady(page);
	});

	test('Draft scrolls inside the page, not the document', async ({
		page,
	}) => {
		await page.locator('button[aria-label="Questions"]').click();
		await expect(
			page.getByText('A fairly long line').first(),
		).toBeVisible();
		await expectAppFillsPane(page);
	});

	test('Revise scrolls inside the page, not the document', async ({
		page,
	}) => {
		await page.locator('button', { hasText: 'Revise' }).click();
		await page
			.locator('button', { hasText: 'Hierarchical Outline' })
			.click();
		await page.locator('button', { hasText: /^Run / }).click();
		await expect(
			page.getByText('A fairly long line').first(),
		).toBeVisible();
		await expectAppFillsPane(page);
	});

	test('Chat scrolls inside the page, not the document', async ({ page }) => {
		await page.locator('button', { hasText: 'Chat' }).click();
		await page.locator('button', { hasText: 'What am I missing?' }).click();
		await expect(
			page.getByText('A fairly long line').first(),
		).toBeVisible();
		await expectAppFillsPane(page);
	});
});

test('Standalone editor demo: the app stays inside its sidebar', async ({
	page,
}) => {
	await setupMockBackend(page);
	await page.route('**/openai/responses', (route) =>
		fulfillOpenAI(route, LONG_REPLY),
	);
	await page.goto('/editor.html?page=demo');
	await waitForEditorReady(page);
	await page.locator('button', { hasText: 'Chat' }).click();
	await page.locator('button', { hasText: 'What am I missing?' }).click();
	await expect(page.getByText('A fairly long line').first()).toBeVisible();
	// The demo page itself may scroll (editor, banner); what matters is that the
	// app didn't outgrow the sidebar it's mounted in.
	await expectAppFillsPane(page, { documentMayScroll: true });
});
