import { describe, expect, it } from 'vitest';
import { simulateReadableStream } from 'ai';
import type { LanguageModelV2StreamPart } from '@ai-sdk/provider';
import { MockLanguageModelV2 } from 'ai/test';
import { generateSuggestion, streamChat, streamRevision } from './ai';
import type { DocContext } from './types';

const docContext: DocContext = {
	beforeCursor: 'The quick brown fox',
	selectedText: '',
	afterCursor: ' jumps over the lazy dog.',
};

// Build a mock text stream of deltas in the LanguageModelV2 stream-part shape.
function textStream(deltas: string[]) {
	const chunks: LanguageModelV2StreamPart[] = [
		{ type: 'text-start', id: '1' },
		...deltas.map((delta) => ({ type: 'text-delta' as const, id: '1', delta })),
		{ type: 'text-end', id: '1' },
		{
			type: 'finish',
			finishReason: 'stop',
			usage: { inputTokens: 1, outputTokens: deltas.length, totalTokens: 1 + deltas.length },
		},
	];
	return simulateReadableStream({ chunks });
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
	let text = '';
	for await (const delta of stream) text += delta;
	return text;
}

describe('generateSuggestion', () => {
	it('returns a GenerationResult with the model text and the requested type', async () => {
		let capturedPrompt = '';
		const model = new MockLanguageModelV2({
			doGenerate: async (options) => {
				capturedPrompt = JSON.stringify(options.prompt);
				return {
					finishReason: 'stop',
					usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
					content: [{ type: 'text', text: '- one\n- two\n- three' }],
					warnings: [],
				};
			},
		});

		const result = await generateSuggestion({
			model,
			type: 'example_sentences',
			docContext,
		});

		expect(result.generation_type).toBe('example_sentences');
		expect(result.result).toBe('- one\n- two\n- three');
		expect(result.extra_data).toEqual({});
		// The document text was woven into the prompt sent to the model.
		expect(capturedPrompt).toContain('The quick brown fox');
	});
});

describe('streamChat', () => {
	it('streams the assistant text deltas', async () => {
		const model = new MockLanguageModelV2({
			doStream: async () => ({ stream: textStream(['Hello', ', ', 'world']) }),
		});

		const result = streamChat({
			model,
			messages: [{ role: 'user', content: 'hi' }],
		});

		expect(await collect(result.textStream)).toBe('Hello, world');
	});
});

describe('streamRevision', () => {
	it('streams the visualization text and uses the revise system prompt', async () => {
		let capturedSystem = '';
		const model = new MockLanguageModelV2({
			doStream: async (options) => {
				const systemMessage = options.prompt.find((m) => m.role === 'system');
				capturedSystem = systemMessage ? JSON.stringify(systemMessage.content) : '';
				return { stream: textStream(['[', 'viz', ']']) };
			},
		});

		const result = streamRevision({
			model,
			docContext,
			request: 'Show me the structure',
		});

		expect(await collect(result.textStream)).toBe('[viz]');
		expect(capturedSystem).toContain('visualization');
	});
});
