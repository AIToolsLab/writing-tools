import { describe, expect, it } from 'vitest';
import type { Continuation, ScoredToken } from '@/api/writingEngine';
import {
	completeWords,
	firstUnits,
	firstWords,
	rangesFromScores,
	unitBranches,
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

const cont = (text: string, prob: number, done = true): Continuation => ({
	text,
	prob,
	end: false,
	done,
});

describe('unitBranches', () => {
	it('adds up continuations that start with the same word', () => {
		// After "a pop": the server's answer for one-word units.
		const got = unitBranches(
			[
				cont('ular spot', 0.75),
				cont('ular favorite', 0.15),
				cont('ular, pleasant', 0.03),
				cont('', 0.01), // ending the message
				cont('lar', 0.001, false),
			],
			1,
		);
		expect(got.map((b) => b.text)).toEqual(['ular', 'ular,', 'lar']);
		expect(got[0].prob).toBeCloseTo(0.9);
	});

	it('puts whole units ahead of partial ones', () => {
		const got = unitBranches(
			[cont(' deep', 0.6, false), cont(' care about', 0.1)],
			1,
		);
		expect(got.map((b) => b.text)).toEqual([' care', ' deep']);
	});

	it('groups by two words when asked', () => {
		const got = unitBranches(
			[cont(' deep learning is', 0.3), cont(' deep learning,', 0.2)],
			2,
		);
		expect(got).toHaveLength(2);
		expect(got[0].text).toBe(' deep learning');
	});
});

describe('word helpers', () => {
	it('finds complete words only when followed by whitespace', () => {
		expect(completeWords(' deep learning', 1)).toBe(' deep');
		expect(completeWords(' deep', 1)).toBeNull();
		expect(firstWords(' deep learning is', 2)).toBe(' deep learning');
	});

	it('segments scripts without spaces', () => {
		expect(firstUnits('我们今天', 1).text.length).toBeGreaterThan(0);
		expect(firstUnits(' deep learning', 1)).toEqual({
			text: ' deep',
			complete: true,
		});
	});
});
