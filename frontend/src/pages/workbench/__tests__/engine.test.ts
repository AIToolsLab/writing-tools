import { describe, expect, it } from 'vitest';
import type {
	Continuation,
	EngineClient,
	ScoredToken,
} from '@/api/writingEngine';
import {
	correctionSuggestions,
	narrow,
	Predictor,
	rangesFromScores,
	unitSuggestions,
} from '../engine';

const tok = (
	text: string,
	logprob: number,
	top = text,
	top_logprob = logprob,
): ScoredToken => ({ text, logprob, top, top_logprob });

describe('rangesFromScores', () => {
	// Shaped like /v1/score: tokens that split a character arrive merged.
	const tokens = [
		tok('A', -0.1),
		// Written " big"; model preferred " large" by e^2.
		tok(' big', -3, ' large', -1),
		tok(' 𝔽', -9, ' (', -1),
		tok('.', -0.2),
	];

	it('marks where the top choice differs, without the leading space', () => {
		const passage = 'A big 𝔽.';
		const res = rangesFromScores(tokens, passage);
		expect(res.warning).toBe('');
		expect(res.ranges.map((r) => passage.slice(r.start, r.end))).toEqual([
			'big',
			'𝔽',
		]);
		expect(res.ranges[0].alternative).toBe(' large');
		expect(res.ranges[0].detail).toBe('7.4× more likely');
	});

	it('warns when the tokens don’t add up to the passage', () => {
		const res = rangesFromScores(tokens, 'A big 𝔽. extra');
		expect(res.warning).not.toBe('');
	});
});

const cont = (
	text: string,
	prob: number,
	extra: Partial<Continuation> = {},
): Continuation => ({ text, prob, end: false, done: true, ...extra });

describe('unitSuggestions', () => {
	it('adds up continuations that start with the same word', () => {
		// After "a pop": the server's answer for one-word units.
		const got = unitSuggestions(
			[
				cont('ular spot', 0.75),
				cont('ular favorite', 0.15),
				cont('ular, pleasant', 0.03),
				cont('', 0.01, { end: true }), // ending the message
				cont('lar', 0.001, { done: false }),
			],
			1,
		);
		// Punctuation ends a word and is never offered.
		expect(got.map((s) => s.text)).toEqual(['ular', 'lar']);
		expect(got[0].prob).toBeCloseTo(0.93);
	});

	it('puts whole units ahead of partial ones', () => {
		const got = unitSuggestions(
			[cont(' deep', 0.6, { done: false }), cont(' care about', 0.1)],
			1,
		);
		expect(got.map((s) => s.text)).toEqual([' care', ' deep']);
	});

	it('counts ending the turn as ending the word', () => {
		const got = unitSuggestions([cont(' today', 0.2, { end: true })], 1);
		expect(got).toEqual([{ text: ' today', prob: 0.2 }]);
	});

	it('shows at most five', () => {
		const many = Array.from({ length: 8 }, (_, i) => cont(` w${i} x`, 0.1));
		expect(unitSuggestions(many, 1)).toHaveLength(5);
	});
});

describe('narrow', () => {
	it('keeps what still matches, conditioned on the extra text', () => {
		const got = narrow(
			[
				cont(' deep learning', 0.5),
				cont(' depleted', 0.3),
				cont(' care', 0.2),
				cont('ep', 9, { replace: 1 }), // corrections don't narrow
			],
			' de',
		);
		expect(got.map((c) => c.text)).toEqual(['ep learning', 'pleted']);
		expect(got[0].prob).toBeCloseTo(0.5 / 0.8);
	});
});

describe('correctionSuggestions', () => {
	const answer = [
		// "populr" → "popular": replaces the last byte.
		cont('ar spot', 1e8, { replace: 1 }),
		cont('ar place', 1e6, { replace: 1 }),
		// Likelier than what was typed, but not a spelling of it.
		cont('favorite spot', 5e5, { replace: 6 }),
		// A completion, not a correction.
		cont(' spot', 0.5),
	];

	it('offers close spellings of the word being typed', () => {
		const got = correctionSuggestions('a populr', answer, 1);
		expect(got).toEqual([
			{
				text: 'ar',
				correction: { replace: 1, word: 'popular', ratio: 1.01e8 },
			},
		]);
	});

	it('counts replaced bytes, not characters', () => {
		// "café" ends in a 2-byte character.
		const got = correctionSuggestions(
			'the cafée',
			[cont('é spot', 50, { replace: 3 })],
			1,
		);
		expect(got[0].correction).toMatchObject({ replace: 2, word: 'café' });
	});

	it('leaves short words alone', () => {
		expect(
			correctionSuggestions(
				'a te',
				[cont('he x', 1e3, { replace: 1 })],
				1,
			),
		).toEqual([]);
	});
});

describe('Predictor', () => {
	function fakeClient(answers: Continuation[][]): EngineClient {
		return {
			turnPrefix: () => Promise.resolve('PROMPT'),
			continuations: () =>
				Promise.resolve({
					typed: '',
					continuations: answers.shift() ?? [],
					unresolved: 0,
					stats: { total_ms: 10, decoded_tokens: 1, rounds: 1 },
				}),
		} as unknown as EngineClient;
	}
	const ask = (draft: string) => ({
		messages: [
			{ role: 'user' as const, content: 'Rewrite' },
			{ role: 'assistant' as const, content: draft },
		],
		words: 1,
	});

	it('puts corrections first and carries them past a space', async () => {
		const p = new Predictor(
			fakeClient([
				[cont('ar spot', 1e8, { replace: 1 }), cont(' spot', 0.5)],
				// Once a space follows, the server only offers completions.
				[cont('spot ', 0.4)],
			]),
		);
		const first = await p.suggest(ask('a populr'));
		expect(first.suggestions.map((s) => s.text)).toEqual(['ar', ' spot']);

		const updates: string[][] = [];
		const second = await p.suggest({
			...ask('a populr '),
			onUpdate: (items) => updates.push(items.map((s) => s.text)),
		});
		// Narrowed locally first: " spot" minus the typed space.
		expect(updates).toEqual([['spot']]);
		expect(second.suggestions[0]).toEqual({
			text: 'ar ',
			correction: { replace: 2, word: 'popular', ratio: 1e8 },
		});
		expect(second.suggestions[1].text).toBe('spot');
	});
});
