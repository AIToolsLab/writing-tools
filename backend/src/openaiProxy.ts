/**
 * OpenAI passthrough proxy, with per-user token metering.
 *
 * Still a passthrough — the client sends an OpenAI request body and gets the
 * upstream response back unchanged — but it now (a) picks which API key pays for
 * the request, so the main key can't be spent anonymously, and (b) records a
 * content-free usage row so spend can be broken down by user. Nothing about the
 * prompt or the completion is inspected or stored; only the `usage` block is read
 * out of the response.
 *
 * Getting usage back out of a passthrough differs by transport:
 *   - non-streaming: the response is buffered, so `usage` is just a JSON field.
 *   - streaming: the SSE stream is tee'd — one branch goes to the client
 *     untouched, the other is drained here and scanned for the terminal usage
 *     event. Chat Completions only emits it when `stream_options.include_usage`
 *     is set, so we set it on the way out; the Responses API emits it regardless.
 *
 * The usage shapes of both OpenAI APIs are handled (`prompt_tokens` vs
 * `input_tokens`), so a `/responses` route can reuse this by passing a different
 * endpoint.
 */
import type { Context } from 'hono';
import { openaiApiKey, openaiDemoApiKey } from './config.js';
import { captureException } from './posthog.js';
import { ANONYMOUS_USER_ID, DEMO_USER_ID, recordUsage } from './usage.js';

const OPENAI_BASE = 'https://api.openai.com/v1';

export type OpenAIEndpoint = 'chat/completions' | 'responses';

export interface ProxyOptions {
	/** Authenticated user id for this request, or null if there's no session. */
	resolveUserId: (c: Context) => Promise<string | null>;
	/**
	 * Whether auth is configured at all. When it isn't (local dev with
	 * BETTER_AUTH_ENABLED unset), unauthenticated requests are served rather than
	 * refused — otherwise turning auth off would break the whole app.
	 */
	authEnabled: boolean;
}

/** Which key pays for a request, and which bucket its tokens are metered to. */
export interface Attribution {
	apiKey: string;
	userId: string;
}

/**
 * Decide who pays. The bucket always names whoever's key was actually charged, so
 * the usage summary reconciles against the right OpenAI invoice:
 *
 *   - a session          → the main key, metered to that user;
 *   - no session, demo key set → the Thoughtful-demo key, metered to `demo`. This
 *     is how demo mode and the pre-sign-in editor work: they carry no session, and
 *     their spend is capped on OpenAI's side by that project's own limit;
 *   - no session, no demo key, auth on → null, i.e. 401. Fail closed rather than
 *     quietly billing the main key for unauthenticated traffic;
 *   - no session, no demo key, auth off → the main key, metered to `anonymous`.
 *     Local dev only; kept separate from `demo` because a different key paid.
 */
export function attributeRequest(
	userId: string | null,
	authEnabled: boolean,
): Attribution | null {
	if (userId) return { apiKey: openaiApiKey(), userId };

	const demoKey = openaiDemoApiKey();
	if (demoKey) return { apiKey: demoKey, userId: DEMO_USER_ID };

	if (authEnabled) return null;
	return { apiKey: openaiApiKey(), userId: ANONYMOUS_USER_ID };
}

interface RawUsage {
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	reasoningTokens: number;
}

function num(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Pull the usage block out of an OpenAI response object or a single SSE event.
 * Returns null when the object carries no usage — which includes the intermediate
 * streaming chunks, where Chat Completions sends `usage: null`.
 */
export function parseUsage(obj: unknown): RawUsage | null {
	if (typeof obj !== 'object' || obj === null) return null;
	const o = obj as Record<string, any>;
	// Chat Completions puts usage at the top level; the Responses API nests the
	// final object under `response`.
	const u = o.usage ?? o.response?.usage;
	if (typeof u !== 'object' || u === null) return null;

	return {
		inputTokens: num(u.input_tokens ?? u.prompt_tokens),
		cachedInputTokens: num(
			u.input_tokens_details?.cached_tokens ??
				u.prompt_tokens_details?.cached_tokens,
		),
		outputTokens: num(u.output_tokens ?? u.completion_tokens),
		reasoningTokens: num(
			u.output_tokens_details?.reasoning_tokens ??
				u.completion_tokens_details?.reasoning_tokens,
		),
	};
}

/** The model the provider actually served (resolves aliases/snapshots). */
export function parseModel(obj: unknown): string | null {
	if (typeof obj !== 'object' || obj === null) return null;
	const o = obj as Record<string, any>;
	const model = o.model ?? o.response?.model;
	return typeof model === 'string' ? model : null;
}

/**
 * Incremental scanner over an SSE byte stream. Keeps the last usage block and
 * model it saw; usage arrives in the terminal event, so that's what survives.
 */
export function createSseUsageScanner() {
	let pending = '';
	let usage: RawUsage | null = null;
	let model: string | null = null;

	return {
		push(text: string): void {
			pending += text;
			const lines = pending.split('\n');
			// The trailing element is an incomplete line; hold it for the next chunk.
			pending = lines.pop() ?? '';
			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data:')) continue;
				const data = trimmed.slice('data:'.length).trim();
				if (!data || data === '[DONE]') continue;
				try {
					const obj = JSON.parse(data);
					usage = parseUsage(obj) ?? usage;
					model = parseModel(obj) ?? model;
				} catch {
					// Not JSON (comment/keepalive) — nothing to read.
				}
			}
		},
		result(): { usage: RawUsage | null; model: string | null } {
			return { usage, model };
		},
	};
}

/**
 * Force Chat Completions to emit a usage event on streamed responses. Without
 * this the stream ends with no token counts at all and the request can't be
 * costed. Returns the body unchanged for the Responses API (which always reports
 * usage) and for anything we can't parse.
 */
/** Parse the request body once; null when it isn't a JSON object. */
function parseBody(body: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(body);
		return typeof parsed === 'object' && parsed !== null ? parsed : null;
	} catch {
		return null;
	}
}

function withUsageReporting(
	parsed: Record<string, unknown> | null,
	body: string,
	endpoint: OpenAIEndpoint,
): string {
	if (endpoint !== 'chat/completions') return body;
	if (parsed === null || parsed.stream !== true) return body;
	return JSON.stringify({
		...parsed,
		stream_options: {
			...(parsed.stream_options as Record<string, unknown> | undefined),
			include_usage: true,
		},
	});
}

function wantsStream(parsed: Record<string, unknown> | null): boolean {
	return parsed?.stream === true;
}

function requestedModel(parsed: Record<string, unknown> | null): string {
	const model = parsed?.model;
	return typeof model === 'string' ? model : 'unknown';
}

export function openaiProxy(endpoint: OpenAIEndpoint, options: ProxyOptions) {
	return async (c: Context): Promise<Response> => {
		const userId = await options.resolveUserId(c);
		const attribution = attributeRequest(userId, options.authEnabled);
		if (!attribution) return c.json({ detail: 'Unauthorized' }, 401);

		const body = await c.req.text();
		const parsedBody = parseBody(body);
		const streaming = wantsStream(parsedBody);
		const startedAt = Date.now();

		const upstream = await fetch(`${OPENAI_BASE}/${endpoint}`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${attribution.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: withUsageReporting(parsedBody, body, endpoint),
		});

		const contentType =
			upstream.headers.get('content-type') ??
			(streaming ? 'text/event-stream' : 'application/json');

		// Exactly one row per proxied request, including failures: a 4xx/5xx has no
		// usage, but recording it with zero tokens keeps request counts honest and
		// makes a user hammering a failing endpoint visible.
		//
		// `ttftMs` is only meaningful for a stream (see UsageRecord); non-streaming
		// callers pass null rather than a time-to-first-byte that would just be the
		// duration again.
		const meter = (
			usage: RawUsage | null,
			model: string | null,
			ttftMs: number | null,
		) => {
			if (upstream.ok && !usage) {
				console.warn(
					`[openai-proxy] ${endpoint}: no usage in a ${upstream.status} response — spend will be under-reported`,
				);
			}
			try {
				recordUsage({
					userId: attribution.userId,
					provider: 'openai',
					endpoint,
					model: model ?? requestedModel(parsedBody),
					inputTokens: usage?.inputTokens ?? 0,
					cachedInputTokens: usage?.cachedInputTokens ?? 0,
					outputTokens: usage?.outputTokens ?? 0,
					reasoningTokens: usage?.reasoningTokens ?? 0,
					status: upstream.status,
					streamed: streaming,
					durationMs: Date.now() - startedAt,
					ttftMs,
				});
			} catch (e) {
				// Metering must never take down a request the user is paying for.
				void captureException(e, { path: `/api/openai/${endpoint}` });
			}
		};

		if (!streaming || !upstream.body) {
			const text = await upstream.text();
			let parsed: unknown = null;
			try {
				parsed = JSON.parse(text);
			} catch {
				// Non-JSON body (e.g. an upstream error page) — record it unmetered.
			}
			meter(parseUsage(parsed), parseModel(parsed), null);
			return new Response(text, {
				status: upstream.status,
				headers: { 'Content-Type': contentType },
			});
		}

		// One branch to the client byte-for-byte, one to the meter. Draining the
		// meter branch to completion matters: if the user closes the sidebar
		// mid-stream, OpenAI has still generated (and billed for) those tokens, and
		// tee() keeps the source alive as long as this branch is still reading.
		//
		// Reading this branch also dates the first token. tee() pulls from the source
		// as fast as it arrives regardless of how slowly the client reads its branch,
		// so the timing reflects OpenAI, not a stalled sidebar.
		const [toClient, toMeter] = upstream.body.tee();
		void (async () => {
			const scanner = createSseUsageScanner();
			const decoder = new TextDecoder();
			const reader = toMeter.getReader();
			let firstByteAt: number | null = null;
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					firstByteAt ??= Date.now();
					scanner.push(decoder.decode(value, { stream: true }));
				}
			} catch (e) {
				await captureException(e, {
					path: `/api/openai/${endpoint}`,
					phase: 'meter',
				});
			} finally {
				reader.releaseLock();
			}
			const { usage, model } = scanner.result();
			meter(
				usage,
				model,
				firstByteAt === null ? null : firstByteAt - startedAt,
			);
		})();

		return new Response(toClient, {
			status: upstream.status,
			headers: { 'Content-Type': contentType },
		});
	};
}
