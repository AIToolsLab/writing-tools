import { test, expect, type APIRequestContext } from '@playwright/test';

interface StackState {
	requests: Array<{ body: unknown; authorization: string }>;
	unexpectedRequests: string[];
	usage: Array<{
		status: number;
		input_tokens: number;
		output_tokens: number;
	}>;
}

async function readState(request: APIRequestContext): Promise<StackState> {
	return (await (
		await request.get('/api/__test/state')
	).json()) as StackState;
}

test.beforeEach(async ({ page, request }) => {
	expect(
		(
			await request.post('/api/__test/reset', {
				data: { mode: 'success' },
			})
		).ok(),
	).toBe(true);
	// Do not intercept app/API requests. Block analytics/CDNs so no test traffic
	// or document text can leave localhost.
	await page.route('**/*', (route) => {
		const url = new URL(route.request().url());
		return url.origin === 'http://127.0.0.1:4317'
			? route.continue()
			: route.abort();
	});
	await page.goto('/editor.html?page=demo');
	await expect(page.locator('[contenteditable="true"]')).toBeVisible();
	await expect(
		page.getByRole('button', { name: 'Questions', exact: true }),
	).toBeVisible();
});

test('reads the current draft, crosses the HTTP proxy/backend, and renders the response', async ({
	page,
	request,
}) => {
	const editor = page.locator('[contenteditable="true"]');
	const draft = 'The library should stay open later during finals.';
	await editor.fill(draft);
	const responsePromise = page.waitForResponse((response) =>
		response.url().endsWith('/api/openai/responses'),
	);
	await page.getByRole('button', { name: 'Questions', exact: true }).click();
	const response = await responsePromise;
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('text/event-stream');
	expect(response.request().headers()['authorization']).toBeUndefined();
	await expect(
		page.getByText(
			'HTTP round trip 1: consider who needs library access.',
			{ exact: true },
		),
	).toBeVisible();
	let state = await readState(request);
	expect(state.requests).toHaveLength(1);
	expect(JSON.stringify(state.requests[0].body)).toContain(draft);
	expect(state.requests[0].authorization).toBe(
		'Bearer browser-test-server-key',
	);
	expect(state.usage).toEqual([
		{ status: 200, input_tokens: 30, output_tokens: 12 },
	]);
	expect(state.unexpectedRequests).toEqual([]);

	const revision = 'The library trial will run for two weeks.';
	await editor.fill(revision);
	await page.getByRole('button', { name: 'Questions', exact: true }).click();
	await expect(
		page.getByText(
			'HTTP round trip 2: consider who needs library access.',
			{ exact: true },
		),
	).toBeVisible();
	state = await readState(request);
	expect(state.requests).toHaveLength(2);
	expect(JSON.stringify(state.requests[1].body)).toContain(revision);
	expect(JSON.stringify(state.requests[1].body)).not.toContain(draft);
	await expect(editor).toHaveText(revision);
});

test('shows a provider quota error and permits a successful request afterward', async ({
	page,
	request,
}) => {
	await request.post('/api/__test/reset', { data: { mode: 'quota' } });
	const editor = page.locator('[contenteditable="true"]');
	await editor.fill('Students need a quiet space during finals.');
	const button = page.getByRole('button', { name: 'Questions', exact: true });
	await button.click();
	await expect(page.getByRole('alert')).toContainText(/out of credit/i, {
		timeout: 15_000,
	});
	await expect(button).toBeEnabled();
	const state = await readState(request);
	expect(state.requests.length).toBeGreaterThan(0);
	expect(state.usage).toHaveLength(state.requests.length);
	for (const row of state.usage)
		expect(row).toEqual({ status: 429, input_tokens: 0, output_tokens: 0 });
	expect(state.unexpectedRequests).toEqual([]);

	await request.post('/api/__test/reset', { data: { mode: 'success' } });
	await button.click();
	await expect(
		page.getByText(
			'HTTP round trip 1: consider who needs library access.',
			{ exact: true },
		),
	).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
	await expect(editor).toHaveText(
		'Students need a quiet space during finals.',
	);
});
