import { convertArrayToReadableStream } from '@ai-sdk/provider-utils/test';
import { MockLanguageModelV3 } from 'ai/test';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_DOC_BRIEF } from '@/contexts/docBriefContext';
import { parseBriefProposal, requestBriefProposal } from '../briefProposal';

// The module reaches for the real provider at import time; the tests pass a
// mock model per call, so the provider itself is never used.
vi.mock('@/api/openai', () => ({
	languageModel: null,
	openaiProviderOptions: {},
}));

/** See the note in `generate.test.ts` — the part shape is read off the mock. */
type StreamPart =
	Awaited<
		ReturnType<MockLanguageModelV3['doStream']>
	>['stream'] extends ReadableStream<infer Part>
		? Part
		: never;

/** Shaped as in `generate.test.ts` — v3 breaks down both fields. */
const FINISH: StreamPart = {
	type: 'finish',
	finishReason: { unified: 'stop', raw: undefined },
	usage: {
		inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
		outputTokens: { total: 1, text: 1, reasoning: 0 },
	},
};

function modelReturning(text: string) {
	const parts: StreamPart[] = [
		{ type: 'stream-start', warnings: [] },
		{ type: 'text-start', id: '1' },
		{ type: 'text-delta', id: '1', delta: text },
		{ type: 'text-end', id: '1' },
		FINISH,
	];
	return new MockLanguageModelV3({
		doStream: () =>
			Promise.resolve({ stream: convertArrayToReadableStream(parts) }),
	});
}

const DOC: DocContext = {
	beforeCursor: 'A study of how writers use AI tools. ',
	selectedText: '',
	afterCursor: 'We preregister three hypotheses.',
};

describe('parseBriefProposal', () => {
	it('keeps the fields it recognizes', () => {
		expect(
			parseBriefProposal(
				'{"audience":"Reviewers","purpose":"Get a Stage 1 accept"}',
			),
		).toEqual({
			audience: 'Reviewers',
			purpose: 'Get a Stage 1 accept',
		});
	});

	// Models fence JSON despite being told not to, and sometimes introduce it.
	it('finds the object inside a fence or a preamble', () => {
		expect(
			parseBriefProposal(
				'Here you go:\n```json\n{"audience":"Reviewers"}\n```\nHope that helps!',
			),
		).toEqual({ audience: 'Reviewers' });
	});

	it('drops keys that are not brief fields', () => {
		expect(
			parseBriefProposal('{"audience":"Reviewers","tone":"formal"}'),
		).toEqual({ audience: 'Reviewers' });
	});

	it('drops values that are not strings', () => {
		expect(
			parseBriefProposal(
				'{"audience":["Reviewers"],"purpose":"Ship it"}',
			),
		).toEqual({ purpose: 'Ship it' });
	});

	// An absent field and a blank one are the same outcome — no candidate — so
	// the UI only has to check for absence.
	it('treats a blank value as no candidate at all', () => {
		expect(
			parseBriefProposal('{"audience":"   ","purpose":"Ship it"}'),
		).toEqual({ purpose: 'Ship it' });
	});

	it('trims surrounding whitespace', () => {
		expect(parseBriefProposal('{"audience":"  Reviewers\\n"}')).toEqual({
			audience: 'Reviewers',
		});
	});

	// A malformed response should cost an error notice, never a crash.
	it.each([
		['no JSON at all', "I can't help with that."],
		['truncated JSON', '{"audience":"Review'],
		['a bare array', '[1, 2, 3]'],
		['an empty string', ''],
	])('returns nothing for %s', (_label, raw) => {
		expect(parseBriefProposal(raw)).toEqual({});
	});
});

describe('requestBriefProposal', () => {
	it('parses what the model returns', async () => {
		await expect(
			requestBriefProposal({
				docContext: DOC,
				brief: EMPTY_DOC_BRIEF,
				model: modelReturning('{"constraints":"- Under 8 pages"}'),
			}),
		).resolves.toEqual({ constraints: '- Under 8 pages' });
	});

	it('sends the document and the brief the writer has already stated', async () => {
		const model = modelReturning('{}');

		await requestBriefProposal({
			docContext: DOC,
			brief: { ...EMPTY_DOC_BRIEF, audience: 'Reviewers' },
			model,
		});

		const call = model.doStreamCalls[0];
		const sent = JSON.stringify(call.prompt);
		expect(sent).toContain('We preregister three hypotheses.');
		expect(sent).toContain('Reviewers');
	});

	// The brief is never partially written from a failed run: the caller gets
	// the throw and shows an error, rather than an empty proposal that reads as
	// "the document had nothing to say".
	it('throws when the generation fails', async () => {
		const model = new MockLanguageModelV3({
			doStream: () =>
				Promise.resolve({
					stream: convertArrayToReadableStream([
						{ type: 'stream-start', warnings: [] },
						{
							type: 'error',
							error: { code: 'insufficient_quota' },
						},
					] as StreamPart[]),
				}),
		});

		await expect(
			requestBriefProposal({
				docContext: DOC,
				brief: EMPTY_DOC_BRIEF,
				model,
			}),
		).rejects.toThrow();
	});
});
