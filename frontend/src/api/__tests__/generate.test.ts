import { MockLanguageModelV3 } from 'ai/test';
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { describe, expect, it, vi } from 'vitest';
import { GenerationError } from '../errors';
import { generateFullText, streamTextDeltas } from '../generate';

/**
 * The stream-part shape the installed `ai` expects, read off the mock instead of
 * imported by name. The top-level `@ai-sdk/provider` is the v2 copy that
 * `@ai-sdk/openai` still depends on, so it is a spec behind what `ai` itself
 * bundles, and its `LanguageModelV2StreamPart` no longer fits. Deriving keeps
 * this file correct across the next provider-spec bump too.
 */
type StreamPart =
	Awaited<
		ReturnType<MockLanguageModelV3['doStream']>
	>['stream'] extends ReadableStream<infer Part>
		? Part
		: never;

/**
 * The quota failure that motivated these helpers: OpenAI's Responses API sends
 * an `error` SSE event mid-stream, and `@ai-sdk/openai` forwards the whole
 * chunk as the error part's payload.
 */
const QUOTA_ERROR = {
	type: 'error',
	sequence_number: 2,
	error: {
		type: 'insufficient_quota',
		code: 'insufficient_quota',
		message:
			'You exceeded your current quota, please check your plan and billing details.',
	},
};

function modelStreaming(parts: StreamPart[]) {
	return new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: convertArrayToReadableStream(parts) }),
	});
}

function textParts(...deltas: string[]): StreamPart[] {
	return [
		{ type: 'stream-start', warnings: [] },
		{ type: 'text-start', id: '1' },
		...deltas.map(
			(delta): StreamPart => ({
				type: 'text-delta',
				id: '1',
				delta,
			}),
		),
		{ type: 'text-end', id: '1' },
	];
}

const FINISH: StreamPart = {
	type: 'finish',
	// v3 splits the finish reason into the unified value and the provider's own
	// raw string, which a mock has none of.
	finishReason: { unified: 'stop', raw: undefined },
	// The v3 spec breaks each side of the token count down (cache reads,
	// reasoning tokens); these helpers only care that a finish part arrives.
	usage: {
		inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	},
};

async function collect(deltas: AsyncIterable<string>): Promise<string[]> {
	const out: string[] = [];
	for await (const delta of deltas) out.push(delta);
	return out;
}

describe('streamTextDeltas', () => {
	it('yields the text deltas of a successful generation', async () => {
		const deltas = streamTextDeltas({
			model: modelStreaming([...textParts('Hello', ', world'), FINISH]),
			prompt: 'hi',
		});

		expect(await collect(deltas)).toEqual(['Hello', ', world']);
	});

	it('throws a GenerationError when the stream carries an error part', async () => {
		// The SDK's default onError logs; keep the test output clean.
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const deltas = streamTextDeltas({
			model: modelStreaming([
				{ type: 'stream-start', warnings: [] },
				{ type: 'error', error: QUOTA_ERROR },
				FINISH,
			]),
			prompt: 'hi',
		});

		await expect(collect(deltas)).rejects.toThrow(GenerationError);
		consoleError.mockRestore();
	});

	it('reports the quota failure in language the writer can act on', async () => {
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const deltas = streamTextDeltas({
			model: modelStreaming([
				{ type: 'stream-start', warnings: [] },
				{ type: 'error', error: QUOTA_ERROR },
				FINISH,
			]),
			prompt: 'hi',
		});

		const err = await collect(deltas).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(GenerationError);
		const { info } = err as GenerationError;
		expect(info.code).toBe('insufficient_quota');
		expect(info.message).toMatch(/out of credit/i);
		expect(info.detail).toMatch(/exceeded your current quota/i);
		expect(info.retryable).toBe(false);
		consoleError.mockRestore();
	});

	it('keeps the text that arrived before a mid-stream failure', async () => {
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const deltas = streamTextDeltas({
			model: modelStreaming([
				...textParts('Partial answer'),
				{ type: 'error', error: QUOTA_ERROR },
				FINISH,
			]),
			prompt: 'hi',
		});

		const received: string[] = [];
		await expect(
			(async () => {
				for await (const delta of deltas) received.push(delta);
			})(),
		).rejects.toThrow(GenerationError);
		expect(received).toEqual(['Partial answer']);
		consoleError.mockRestore();
	});
});

describe('generateFullText', () => {
	it('returns the whole generation', async () => {
		const text = await generateFullText({
			model: modelStreaming([...textParts('One', ' two'), FINISH]),
			prompt: 'hi',
		});

		expect(text).toBe('One two');
	});

	it('throws instead of resolving to an empty string when generation fails', async () => {
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});

		// This is the regression that made Draft say "No suggestions yet" on a
		// quota error: `streamText(...).text` resolves to '' rather than throwing.
		await expect(
			generateFullText({
				model: modelStreaming([
					{ type: 'stream-start', warnings: [] },
					{ type: 'error', error: QUOTA_ERROR },
					FINISH,
				]),
				prompt: 'hi',
			}),
		).rejects.toThrow(GenerationError);
		consoleError.mockRestore();
	});
});
