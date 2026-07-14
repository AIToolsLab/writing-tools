import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Auth } from '../auth.js';
import { closeDb, db } from '../db.js';
import {
	attributeRequest,
	createSseUsageScanner,
	parseUsage,
} from '../openaiProxy.js';
import {
	ANONYMOUS_USER_ID,
	DEMO_USER_ID,
	summarizeUsage,
	type UsageSummaryRow,
} from '../usage.js';

const env = { ...process.env };

/** Better Auth stub: a session for `user`, or none when null. */
function appWithUser(user: { id: string } | null) {
	const auth = {
		handler: async () => new Response(null),
		api: { getSession: async () => (user ? { user } : null) },
	} as unknown as Auth;
	return createApp({ auth });
}

/** A chat/completions SSE stream ending in the usage event include_usage asks for. */
const CHAT_SSE = [
	`data: {"id":"1","model":"gpt-4o-2024-08-06","choices":[{"delta":{"content":"Hi"}}],"usage":null}\n\n`,
	`data: {"id":"1","model":"gpt-4o-2024-08-06","choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"prompt_tokens_details":{"cached_tokens":100},"completion_tokens_details":{"reasoning_tokens":8}}}\n\n`,
	`data: [DONE]\n\n`,
];

/** Upstream SSE response, delivered in several chunks so the scanner has to reassemble. */
function sseResponse(chunks: string[] = CHAT_SSE): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' },
	});
}

/**
 * An SSE response whose first chunk arrives promptly but whose last one lags —
 * the case where time-to-first-token and total duration diverge.
 */
function slowFinishingSseResponse(tailDelayMs: number): Response {
	const encoder = new TextEncoder();
	const stream = new ReadableStream({
		async start(controller) {
			controller.enqueue(encoder.encode(CHAT_SSE[0] as string));
			await new Promise((r) => setTimeout(r, tailDelayMs));
			controller.enqueue(encoder.encode(CHAT_SSE[1] as string));
			controller.enqueue(encoder.encode(CHAT_SSE[2] as string));
			controller.close();
		},
	});
	return new Response(stream, {
		status: 200,
		headers: { 'Content-Type': 'text/event-stream' },
	});
}

/** Streaming usage is metered on a background branch; give it a moment to land. */
async function waitForUsage(): Promise<UsageSummaryRow[]> {
	for (let i = 0; i < 50; i++) {
		const rows = summarizeUsage(0, Date.now() + 1000);
		if (rows.length > 0) return rows;
		await new Promise((r) => setTimeout(r, 10));
	}
	return [];
}

/** The raw timing columns, which the (cost-focused) summary doesn't expose. */
function timingRow(): { duration_ms: number; ttft_ms: number | null } {
	return db().prepare(`SELECT duration_ms, ttft_ms FROM llm_usage`).get() as {
		duration_ms: number;
		ttft_ms: number | null;
	};
}

beforeEach(async () => {
	process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'wt-proxy-'));
	process.env.OPENAI_API_KEY = 'test-key';
	process.env.LOG_SECRET = 'test-secret';
});

afterEach(() => {
	closeDb();
	vi.unstubAllGlobals();
	process.env = { ...env };
});

describe('parseUsage', () => {
	it('reads the Chat Completions shape', () => {
		expect(
			parseUsage({
				usage: {
					prompt_tokens: 120,
					completion_tokens: 30,
					prompt_tokens_details: { cached_tokens: 100 },
					completion_tokens_details: { reasoning_tokens: 8 },
				},
			}),
		).toEqual({
			inputTokens: 120,
			cachedInputTokens: 100,
			outputTokens: 30,
			reasoningTokens: 8,
		});
	});

	it('reads the Responses shape, where usage is nested under `response`', () => {
		expect(
			parseUsage({
				type: 'response.completed',
				response: {
					usage: {
						input_tokens: 7,
						output_tokens: 2,
						input_tokens_details: { cached_tokens: 3 },
						output_tokens_details: { reasoning_tokens: 1 },
					},
				},
			}),
		).toEqual({
			inputTokens: 7,
			cachedInputTokens: 3,
			outputTokens: 2,
			reasoningTokens: 1,
		});
	});

	it('returns null for the intermediate chunks that carry `usage: null`', () => {
		expect(parseUsage({ choices: [{ delta: {} }], usage: null })).toBeNull();
	});
});

describe('createSseUsageScanner', () => {
	it('finds the terminal usage event across chunk boundaries', () => {
		const scanner = createSseUsageScanner();
		// Split mid-JSON to prove the line buffer reassembles it.
		const whole = CHAT_SSE.join('');
		scanner.push(whole.slice(0, 200));
		scanner.push(whole.slice(200));

		const { usage, model } = scanner.result();
		expect(usage).toEqual({
			inputTokens: 120,
			cachedInputTokens: 100,
			outputTokens: 30,
			reasoningTokens: 8,
		});
		// The served snapshot, not the alias the client asked for.
		expect(model).toBe('gpt-4o-2024-08-06');
	});

	it('ignores [DONE] and non-JSON keepalives', () => {
		const scanner = createSseUsageScanner();
		scanner.push(': keepalive\n\ndata: [DONE]\n\n');
		expect(scanner.result().usage).toBeNull();
	});
});

describe('attributeRequest', () => {
	it('bills a signed-in user to the main key', () => {
		expect(attributeRequest('usr-1', true)).toEqual({
			apiKey: 'test-key',
			userId: 'usr-1',
		});
	});

	it('sends sessionless traffic to the capped demo key', () => {
		process.env.OPENAI_DEMO_API_KEY = 'demo-key';
		expect(attributeRequest(null, true)).toEqual({
			apiKey: 'demo-key',
			userId: DEMO_USER_ID,
		});
	});

	it('fails closed when auth is on and no demo key is configured', () => {
		// Never quietly bill the main key for traffic we can't attribute.
		expect(attributeRequest(null, true)).toBeNull();
	});

	it('falls back to the main key in local dev, bucketed apart from demo', () => {
		expect(attributeRequest(null, false)).toEqual({
			apiKey: 'test-key',
			userId: ANONYMOUS_USER_ID,
		});
	});
});

describe('POST /api/openai/chat/completions', () => {
	it('rejects a sessionless request, with no demo key, without calling OpenAI', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const res = await appWithUser(null).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o', stream: true }),
			},
		);

		expect(res.status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('serves a sessionless request on the demo key and meters it to `demo`', async () => {
		// Demo mode sends a token that isn't a session, so it lands here — the path
		// that would otherwise 401 once the proxy started requiring auth.
		process.env.OPENAI_DEMO_API_KEY = 'demo-key';
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
			sseResponse(),
		);
		vi.stubGlobal('fetch', fetchMock);

		const res = await appWithUser(null).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer demo-access-token',
				},
				body: JSON.stringify({ model: 'gpt-4o', stream: true }),
			},
		);

		expect(res.status).toBe(200);
		await res.text();

		// The demo project's key paid, not the main one.
		const sentHeaders = fetchMock.mock.calls[0]?.[1]?.headers as
			| Record<string, string>
			| undefined;
		expect(sentHeaders?.Authorization).toBe('Bearer demo-key');

		const rows = await waitForUsage();
		expect(rows[0]).toMatchObject({ userId: DEMO_USER_ID, requests: 1 });
	});

	it('streams the response through untouched and meters usage to the session user', async () => {
		const fetchMock = vi.fn(async () => sseResponse());
		vi.stubGlobal('fetch', fetchMock);

		const res = await appWithUser({ id: 'usr-123' }).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o', stream: true }),
			},
		);

		expect(res.status).toBe(200);
		// The client's bytes are the upstream's bytes.
		expect(await res.text()).toBe(CHAT_SSE.join(''));

		const rows = await waitForUsage();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userId: 'usr-123',
			provider: 'openai',
			model: 'gpt-4o-2024-08-06',
			requests: 1,
			inputTokens: 120,
			cachedInputTokens: 100,
			outputTokens: 30,
			reasoningTokens: 8,
		});
	});

	it('asks OpenAI to report usage on streamed requests', async () => {
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
			sseResponse(),
		);
		vi.stubGlobal('fetch', fetchMock);

		const res = await appWithUser({ id: 'usr-123' }).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o', stream: true }),
			},
		);
		await res.text();

		const sent = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
		expect(sent.stream_options).toEqual({ include_usage: true });
		// Everything else about the request is passed through as the client sent it.
		expect(sent.model).toBe('gpt-4o');
		expect(sent.stream).toBe(true);
	});

	it('times the first token separately from the whole generation', async () => {
		// First chunk lands immediately, the rest 150ms later: ttft should track the
		// former and duration the latter, which is the entire point of having both.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => slowFinishingSseResponse(150)),
		);

		const res = await appWithUser({ id: 'usr-1' }).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o', stream: true }),
			},
		);
		await res.text();
		await waitForUsage();

		const { duration_ms, ttft_ms } = timingRow();
		expect(ttft_ms).not.toBeNull();
		expect(duration_ms).toBeGreaterThanOrEqual(150);
		// The user saw text long before the generation finished.
		expect(ttft_ms as number).toBeLessThan(duration_ms - 100);
	});

	it('leaves ttft null when the response is not streamed', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							model: 'gpt-4o',
							usage: { prompt_tokens: 5, completion_tokens: 1 },
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					),
			),
		);

		const res = await appWithUser({ id: 'usr-1' }).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o' }),
			},
		);
		await res.json();
		await waitForUsage();

		expect(timingRow().ttft_ms).toBeNull();
	});

	it('meters a non-streaming response from its JSON usage block', async () => {
		const body = {
			model: 'gpt-4o-2024-08-06',
			choices: [{ message: { content: 'Hi' } }],
			usage: { prompt_tokens: 40, completion_tokens: 9 },
		};
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify(body), {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}),
			),
		);

		const res = await appWithUser({ id: 'usr-9' }).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o' }),
			},
		);

		expect(await res.json()).toEqual(body);
		const rows = await waitForUsage();
		expect(rows[0]).toMatchObject({
			userId: 'usr-9',
			inputTokens: 40,
			outputTokens: 9,
		});
	});

	it('meters as anonymous when auth is disabled, rather than rejecting', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => sseResponse()),
		);

		// createApp() with no auth — local dev.
		const res = await createApp().request('/api/openai/chat/completions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: 'gpt-4o', stream: true }),
		});

		expect(res.status).toBe(200);
		await res.text();
		const rows = await waitForUsage();
		expect(rows[0]).toMatchObject({ userId: ANONYMOUS_USER_ID });
	});
});

describe('GET /api/usage_summary', () => {
	it('rejects a bad secret', async () => {
		const res = await createApp().request('/api/usage_summary?secret=wrong');
		expect(res.status).toBe(403);
	});

	it('breaks spend down by user, costed from the stored token counts', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => sseResponse()),
		);
		const proxied = await appWithUser({ id: 'usr-spender' }).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o', stream: true }),
			},
		);
		await proxied.text();
		await waitForUsage();

		const res = await createApp().request(
			'/api/usage_summary?secret=test-secret',
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			totals: Array<{ userId: string; costUsd: number; requests: number }>;
			unpricedModels: string[];
		};

		expect(body.totals).toHaveLength(1);
		expect(body.totals[0]).toMatchObject({
			userId: 'usr-spender',
			requests: 1,
		});
		// The SSE fixture reports 120 input (100 of them cached) and 30 output on
		// gpt-4o: 20 uncached @ $2.50/1M + 100 cached @ $1.25/1M + 30 out @ $10/1M.
		expect(body.totals[0]?.costUsd).toBeCloseTo(
			(20 * 2.5 + 100 * 1.25 + 30 * 10) / 1_000_000,
			10,
		);
		expect(body.unpricedModels).toEqual([]);
	});

	it('flags a model with no rate instead of costing it at zero', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							model: 'gpt-6-turbo',
							usage: { prompt_tokens: 10, completion_tokens: 5 },
						}),
						{ status: 200, headers: { 'Content-Type': 'application/json' } },
					),
			),
		);
		const proxied = await appWithUser({ id: 'usr-1' }).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-6-turbo' }),
			},
		);
		await proxied.json();
		await waitForUsage();

		const summary = (await (
			await createApp().request('/api/usage_summary?secret=test-secret')
		).json()) as {
			rows: Array<{ costUsd: number | null }>;
			unpricedModels: string[];
		};
		expect(summary.rows[0]?.costUsd).toBeNull();
		expect(summary.unpricedModels).toEqual(['gpt-6-turbo']);
	});
});
