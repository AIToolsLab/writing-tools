/** Real frontend prompt/SDK -> real Hono routes -> fake provider SSE.
 * No real credentials, sockets, or paid requests; storage is a disposable DB.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '../../backend/src/app';
import { closeDb, db } from '../../backend/src/db';
import { buildMessages, DRAFT_INSTRUCTIONS } from '../src/api/prompts';
import { generateFullText } from '../src/api/generate';
import {
	languageModel,
	OPENAI_MODEL,
	setOpenAITokenProvider,
} from '../src/api/openai';
import { GenerationError } from '../src/api/errors';

let storage;
let app;
let provider;
let browserRequests;

function responseStream() {
	const event = (payload) => `data: ${JSON.stringify(payload)}\n\n`;
	const data =
		event({
			type: 'response.created',
			response: { id: 'resp-test', created_at: 0, model: OPENAI_MODEL },
		}) +
		event({
			type: 'response.output_item.added',
			output_index: 0,
			item: { type: 'message', id: 'msg-test' },
		}) +
		event({
			type: 'response.output_text.delta',
			item_id: 'msg-test',
			delta: '- A useful ',
		}) +
		event({
			type: 'response.output_text.delta',
			item_id: 'msg-test',
			delta: 'suggestion.',
		}) +
		event({
			type: 'response.completed',
			response: {
				model: OPENAI_MODEL,
				usage: { input_tokens: 20, output_tokens: 5 },
			},
		}) +
		'data: [DONE]\n\n';
	// Split inside event boundaries to exercise actual incremental forwarding.
	const bytes = new TextEncoder().encode(data);
	return new Response(
		new ReadableStream({
			start(controller) {
				for (let i = 0; i < bytes.length; i += 17)
					controller.enqueue(bytes.slice(i, i + 17));
				controller.close();
			},
		}),
		{ headers: { 'content-type': 'text/event-stream' } },
	);
}

beforeEach(async () => {
	storage = await mkdtemp(path.join(tmpdir(), 'writing-roundtrip-'));
	vi.stubEnv('DATA_DIR', storage);
	vi.stubEnv('OPENAI_API_KEY', 'test-backend-only-key');
	vi.stubEnv('OPENAI_DEMO_API_KEY', '');
	vi.stubEnv('DISABLE_POSTHOG', '1');
	app = createApp();
	provider = vi.fn(async () => responseStream());
	browserRequests = [];
	setOpenAITokenProvider(async () => '');
	vi.stubGlobal('fetch', async (input, init) => {
		const request = new Request(
			typeof input === 'string'
				? new URL(input, 'http://app.test')
				: input,
			init,
		);
		const url = new URL(request.url);
		if (
			url.origin === 'http://app.test' &&
			url.pathname.startsWith('/api/')
		) {
			browserRequests.push(request.clone());
			return app.fetch(request);
		}
		if (
			url.origin === 'https://api.openai.com' &&
			url.pathname === '/v1/responses'
		)
			return provider(request);
		throw new Error(`Unexpected network request: ${request.url}`);
	});
});

afterEach(async () => {
	setOpenAITokenProvider(async () => '');
	closeDb();
	if (storage) await rm(storage, { recursive: true, force: true });
});

function generate() {
	return generateFullText({
		model: languageModel,
		instructions: DRAFT_INSTRUCTIONS,
		messages: buildMessages('example_sentences', {
			beforeCursor: 'The library ',
			selectedText: 'should stay',
			afterCursor: ' open later.',
		}),
		maxRetries: 0,
	});
}

it('sends the document through the real backend, returns streamed text and meters usage', async () => {
	expect(await generate()).toBe('- A useful suggestion.');
	expect(browserRequests).toHaveLength(1);
	expect(new URL(browserRequests[0].url).pathname).toBe(
		'/api/openai/responses',
	);
	expect(browserRequests[0].headers.has('authorization')).toBe(false);
	const browserBody = await browserRequests[0].json();
	expect(JSON.stringify(browserBody)).toContain(
		'The library should stay open later.',
	);
	expect(provider).toHaveBeenCalledTimes(1);
	const upstream = provider.mock.calls[0][0];
	expect(upstream.headers.get('authorization')).toBe(
		'Bearer test-backend-only-key',
	);
	expect(await upstream.json()).toEqual(browserBody);
	expect(
		db()
			.prepare(
				'SELECT model, input_tokens, output_tokens, status FROM llm_usage',
			)
			.all(),
	).toEqual([
		{
			model: OPENAI_MODEL,
			input_tokens: 20,
			output_tokens: 5,
			status: 200,
		},
	]);
});

it('preserves a provider quota error through the backend and frontend error handling', async () => {
	provider.mockImplementation(
		async () =>
			new Response(
				JSON.stringify({
					error: {
						type: 'insufficient_quota',
						code: 'insufficient_quota',
						message: 'You exceeded your current quota.',
					},
				}),
				{
					status: 429,
					headers: { 'content-type': 'application/json' },
				},
			),
	);
	const error = await generate().catch((caught) => caught);
	expect(error).toBeInstanceOf(GenerationError);
	expect(error.info.code).toBe('insufficient_quota');
	expect(error.info.retryable).toBe(false);
	expect(
		db()
			.prepare(
				'SELECT status, input_tokens, output_tokens FROM llm_usage',
			)
			.all(),
	).toEqual([{ status: 429, input_tokens: 0, output_tokens: 0 }]);
});

it('surfaces invalid session credentials without calling the AI provider', async () => {
	setOpenAITokenProvider(async () => 'expired-session');
	const error = await generate().catch((caught) => caught);
	expect(error).toBeInstanceOf(GenerationError);
	expect(error.info.code).toBe('platform_auth');
	expect(provider).not.toHaveBeenCalled();
	expect(
		db().prepare('SELECT count(*) AS count FROM llm_usage').get(),
	).toEqual({ count: 0 });
});
