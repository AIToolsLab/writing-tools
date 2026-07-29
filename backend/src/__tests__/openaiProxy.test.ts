import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Auth, SessionUser } from '../auth.js';
import { closeDb, db } from '../db.js';
import {
	attributeRequest,
	createSseUsageScanner,
	parseUsage,
	PLATFORM_AUTH_ERROR_HEADER,
} from '../openaiProxy.js';
import {
	ANONYMOUS_USER_ID,
	DEMO_USER_ID,
	summarizeUsage,
	type UsageSummaryRow,
} from '../usage.js';
import { CONSENT_LEVELS, FULL_CONSENT_LEVEL } from '../consent.js';

/** Better Auth stub: a session for `user`, or none when null. */
function appWithUser(user: SessionUser | null) {
	const auth = {
		handler: async () => new Response(null),
		api: { getSession: async () => (user ? { user } : null) },
	} as unknown as Auth;
	return createApp({ auth });
}

// Two example users. `email` is what resolveUser recomputes isAllowed from — a Calvin
// address so the real user passes the beta allowlist; anon users are always allowed.
const real = (id: string) =>
	({
		id,
		email: `${id}@calvin.edu`,
		isAnonymous: false,
		loggingConsent: CONSENT_LEVELS[2],
		isAllowed: true,
		clientId: null,
	}) as SessionUser;
const anon = (id: string) =>
	({
		id,
		isAnonymous: true,
		loggingConsent: FULL_CONSENT_LEVEL,
		isAllowed: true,
		clientId: null,
	}) as SessionUser;


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
	vi.stubEnv("DATA_DIR", await mkdtemp(path.join(tmpdir(), 'wt-proxy-')));
	vi.stubEnv("OPENAI_API_KEY", 'test-key');
	vi.stubEnv("LOG_SECRET", 'test-secret');
	// OPENAI_DEMO_API_KEY is left unset by default: the tests that exercise the
	// "no demo key configured" fail-closed path depend on its absence. Only the
	// tests that need it stub it in.
});

afterEach(() => {
	closeDb();
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
	it('bills a real signed-in user to the main key', () => {
		expect(attributeRequest(real('usr-1'), true)).toEqual({
			apiKey: 'test-key',
			userId: 'usr-1',
		});
	});

	it('bills an anonymous (demo) user to the capped demo key, metered to their own id', () => {
		// The key is capped, but metering stays per-user so a future per-demo-user cap
		// can read it — NOT collapsed into the shared `demo` bucket.
		vi.stubEnv("OPENAI_DEMO_API_KEY", 'demo-key');
		expect(attributeRequest(anon('anon-1'), true)).toEqual({
			apiKey: 'demo-key',
			userId: 'anon-1',
		});
	});

	it('fails closed for an anonymous user when no demo key is configured', () => {
		// An anon user must never fall through to the main key with auth on.
		expect(attributeRequest(anon('anon-1'), true)).toBeNull();
	});

	it('sends sessionless traffic to the capped demo key, shared `demo` bucket', () => {
		vi.stubEnv("OPENAI_DEMO_API_KEY", 'demo-key');
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
		expect(res.headers.get(PLATFORM_AUTH_ERROR_HEADER)).toBe('platform-auth');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects a presented invalid tool token even when demo access is configured', async () => {
		vi.stubEnv('OPENAI_DEMO_API_KEY', 'demo-key');
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		const res = await appWithUser(null).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer wtk_invalid-or-revoked',
				},
				body: JSON.stringify({ model: 'gpt-4o' }),
			},
		);

		expect(res.status).toBe(401);
		expect(res.headers.get(PLATFORM_AUTH_ERROR_HEADER)).toBe('platform-auth');
		expect(await res.json()).toEqual({
			error: { code: 'platform_auth' },
			detail: 'Tool access token is invalid or expired.',
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('forbids a signed-in user who is not on the beta allowlist, without calling OpenAI', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);

		// A real session whose email is outside the allowlist: resolveUser recomputes
		// isAllowed=false, so the proxy fails closed even though the session is valid.
		const disallowed = {
			id: 'usr-outside',
			email: 'someone@gmail.com',
			isAnonymous: false,
			loggingConsent: CONSENT_LEVELS[2],
		} as unknown as SessionUser;

		const res = await appWithUser(disallowed).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: 'Bearer token',
				},
				body: JSON.stringify({ model: 'gpt-4o', stream: true }),
			},
		);

		expect(res.status).toBe(403);
		expect(res.headers.get(PLATFORM_AUTH_ERROR_HEADER)).toBe('platform-auth');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not mark an upstream OpenAI authentication error as platform auth', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(JSON.stringify({ error: { message: 'provider key' } }), {
					status: 401,
					headers: { 'Content-Type': 'application/json' },
				}),
			),
		);
		const res = await appWithUser(real('usr-upstream')).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o' }),
			},
		);
		expect(res.status).toBe(401);
		expect(res.headers.get(PLATFORM_AUTH_ERROR_HEADER)).toBeNull();
	});

	it('exposes the platform-auth marker header through CORS', async () => {
		const res = await appWithUser(null).request(
			'/api/openai/chat/completions',
			{
				method: 'OPTIONS',
				headers: {
					Origin: 'https://mindmap.example',
					'Access-Control-Request-Method': 'POST',
				},
			},
		);
		expect(res.headers.get('Access-Control-Expose-Headers')).toContain(
			PLATFORM_AUTH_ERROR_HEADER,
		);
	});

	it('serves a sessionless request on the demo key and meters it to `demo`', async () => {
		// Demo mode sends a token that isn't a session, so it lands here — the path
		// that would otherwise 401 once the proxy started requiring auth.
		vi.stubEnv("OPENAI_DEMO_API_KEY", 'demo-key');
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

	it('serves an anonymous (demo) session on the demo key, metered to its own id', async () => {
		// A real anonymous session (Better Auth anonymous plugin): spends the capped
		// demo key like sessionless demo traffic, but meters to the user's own id so
		// per-demo-user spend is attributable.
		vi.stubEnv("OPENAI_DEMO_API_KEY", 'demo-key');
		const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
			sseResponse(),
		);
		vi.stubGlobal('fetch', fetchMock);

		const res = await appWithUser(anon('anon-7')).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o', stream: true }),
			},
		);

		expect(res.status).toBe(200);
		await res.text();

		const sentHeaders = fetchMock.mock.calls[0]?.[1]?.headers as
			| Record<string, string>
			| undefined;
		expect(sentHeaders?.Authorization).toBe('Bearer demo-key');

		const rows = await waitForUsage();
		expect(rows[0]).toMatchObject({ userId: 'anon-7', requests: 1 });
	});

	it('streams the response through untouched and meters usage to the session user', async () => {
		const fetchMock = vi.fn(async () => sseResponse());
		vi.stubGlobal('fetch', fetchMock);

		const res = await appWithUser(real('usr-123')).request(
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

		const res = await appWithUser(real('usr-123')).request(
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

		const res = await appWithUser(real('usr-1')).request(
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

		const res = await appWithUser(real('usr-1')).request(
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

		const res = await appWithUser(real('usr-9')).request(
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

	it('rejects an empty-bodied upstream 200 as a 502 instead of relaying it', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(null, {
						status: 200,
						headers: { 'Content-Type': 'application/json' },
					}),
			),
		);
		const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const res = await appWithUser(real('usr-e')).request(
			'/api/openai/chat/completions',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ model: 'gpt-4o' }),
			},
		);

		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({
			detail: 'Upstream returned an empty response',
		});
		expect(errSpy).toHaveBeenCalledOnce();
	});
});

describe('POST /api/openai/responses', () => {
	it('proxies to the responses endpoint and meters usage to the session user', async () => {
		const body = {
			model: 'gpt-4o-2024-08-06',
			output: [{ content: [{ text: 'Hi' }] }],
			usage: { input_tokens: 40, output_tokens: 9 },
		};
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response(JSON.stringify(body), {
					status: 200,
					headers: { 'Content-Type': 'application/json' },
				}),
		);
		vi.stubGlobal('fetch', fetchMock);

		const requestBody = {
			model: 'gpt-4o',
			input: 'hi',
			tools: [{ type: 'web_search_preview' }],
			temperature: 0.4,
			max_output_tokens: 321,
			metadata: { surface: 'mindmap' },
		};
		const res = await appWithUser(real('usr-r')).request(
			'/api/openai/responses',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(requestBody),
			},
		);

		expect(res.status).toBe(200);
		expect(fetchMock.mock.calls[0]?.[0]).toBe(
			'https://api.openai.com/v1/responses',
		);
		expect(
			JSON.parse(
				String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
			),
		).toEqual(requestBody);
		expect(await res.json()).toEqual(body);
		const rows = await waitForUsage();
		expect(rows[0]).toMatchObject({
			userId: 'usr-r',
			inputTokens: 40,
			outputTokens: 9,
		});
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
		const proxied = await appWithUser(real('usr-spender')).request(
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
		const proxied = await appWithUser(real('usr-1')).request(
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
