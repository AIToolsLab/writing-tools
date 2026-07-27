import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV2 } from 'ai/test';
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { describe, expect, it, vi } from 'vitest';
import { GenerationError } from '../errors';
import { generateFullText, streamTextDeltas } from '../generate';

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

function modelStreaming(parts: LanguageModelV2StreamPart[]) {
	return new MockLanguageModelV2({
		doStream: () =>
			Promise.resolve({ stream: convertArrayToReadableStream(parts) }),
	});
}

function textParts(...deltas: string[]): LanguageModelV2StreamPart[] {
	return [
		{ type: 'stream-start', warnings: [] },
		{ type: 'text-start', id: '1' },
		...deltas.map((delta): LanguageModelV2StreamPart => ({
			type: 'text-delta',
			id: '1',
			delta,
		})),
		{ type: 'text-end', id: '1' },
	];
}

const FINISH: LanguageModelV2StreamPart = {
	type: 'finish',
	finishReason: 'stop',
	usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
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
