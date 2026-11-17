import { MockLanguageModelV4 } from 'ai/test';
import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { tool } from 'ai';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { GenerationError } from '../errors';
import { generateFullText, streamParts, streamTextDeltas } from '../generate';

/**
 * The stream-part shape the installed `ai` expects, read off the mock instead of
 * imported by name. Deriving it keeps this file correct across provider-spec
 * bumps: the named `LanguageModelV*StreamPart` type moves with
 * `@ai-sdk/provider`, and which copy of that package a bare import resolves to
 * depends on hoisting.
 *
 * Mock at the spec version the real provider speaks (`@ai-sdk/openai` v4 →
 * `specificationVersion: 'v4'`), so these tests exercise the same path
 * production does rather than `ai`'s back-compat shim for older models.
 */
type StreamPart =
	Awaited<
		ReturnType<MockLanguageModelV4['doStream']>
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
	return new MockLanguageModelV4({
		doStream: () =>
			Promise.resolve({ stream: convertArrayToReadableStream(parts) }),
	});
}

function textParts(...deltas: string[]): StreamPart[] {
	return [
		{ type: 'stream-start', warnings: [] },
		{ type: 'text-start', id: '1' },
		...deltas.map((delta): StreamPart => ({
			type: 'text-delta',
			id: '1',
			delta,
		})),
		{ type: 'text-end', id: '1' },
	];
}

const FINISH: StreamPart = {
	type: 'finish',
	// The spec splits the finish reason into the unified value and the provider's
	// own raw string, which a mock has none of.
	finishReason: { unified: 'stop', raw: undefined },
	// It also breaks each side of the token count down (cache reads, reasoning
	// tokens); these helpers only care that a finish part arrives.
	usage: {
		inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	},
};

const TOOL_CALL_FINISH: StreamPart = {
	...FINISH,
	finishReason: { unified: 'tool-calls', raw: undefined },
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

describe('streamParts', () => {
	it('yields tool calls and returns the response messages', async () => {
		const parts = streamParts({
			model: modelStreaming([
				...textParts('Let me look.'),
				{
					type: 'tool-call',
					toolCallId: 'call-1',
					toolName: 'view',
					input: '{}',
				},
				TOOL_CALL_FINISH,
			]),
			// No `execute`: the loop stops at the call, as a staged edit would.
			tools: { view: tool({ inputSchema: z.object({}) }) },
			prompt: 'hi',
		});

		const types: string[] = [];
		let next = await parts.next();
		while (!next.done) {
			types.push(next.value.type);
			next = await parts.next();
		}

		expect(types).toContain('tool-call');
		expect(next.value).toEqual([
			{
				role: 'assistant',
				content: [
					{ type: 'text', text: 'Let me look.' },
					expect.objectContaining({
						type: 'tool-call',
						toolCallId: 'call-1',
						toolName: 'view',
					}),
				],
			},
		]);
	});

	it('throws a GenerationError instead of yielding an error part', async () => {
		const consoleError = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});
		const parts = streamParts({
			model: modelStreaming([
				{ type: 'stream-start', warnings: [] },
				{ type: 'error', error: QUOTA_ERROR },
				FINISH,
			]),
			prompt: 'hi',
		});

		const types: string[] = [];
		await expect(
			(async () => {
				for await (const part of parts) types.push(part.type);
			})(),
		).rejects.toThrow(GenerationError);
		expect(types).not.toContain('error');
		consoleError.mockRestore();
	});
});
