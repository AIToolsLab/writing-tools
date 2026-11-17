import { describe, expect, it } from 'vitest';
import {
	completeWords,
	firstUnits,
	firstWords,
	spellingDistance,
} from '../words';

describe('word units', () => {
	it('finds complete words only once their end is known', () => {
		expect(completeWords(' deep learning', 1)).toBe(' deep');
		expect(completeWords(' deep', 1)).toBeNull();
		expect(firstWords(' deep learning is', 2)).toBe(' deep learning');
	});

	it('ends a word at punctuation, and offers nothing that starts with it', () => {
		expect(completeWords(' deep, then', 1)).toBe(' deep');
		expect(completeWords(', then', 1)).toBe('');
		expect(firstWords('.', 1)).toBe('');
	});

	it('keeps punctuation between letters inside the word', () => {
		expect(completeWords(' U.S. law', 1)).toBe(' U.S.');
		expect(completeWords(' 1,000 people', 1)).toBe(' 1,000');
		expect(completeWords(' and/or more', 1)).toBe(' and/or');
		// "U." alone isn't known to end: "S" may follow.
		expect(completeWords(' U.', 1)).toBeNull();
	});

	it('ends words at Markdown and HTML characters', () => {
		expect(completeWords(' bold** text', 1)).toBe(' bold');
	});

	it('segments scripts without spaces', () => {
		expect(firstUnits('我们今天', 1).text.length).toBeGreaterThan(0);
		expect(firstUnits(' deep learning', 1)).toEqual({
			text: ' deep',
			complete: true,
		});
	});
});

describe('spellingDistance', () => {
	it('counts a swap of neighbors as one edit', () => {
		expect(spellingDistance('teh', 'the', false)).toBe(1);
		expect(spellingDistance('populr', 'popular', false)).toBe(1);
	});

	it('compares a word still being typed with the closest start', () => {
		expect(spellingDistance('popul', 'popular', true)).toBe(0);
		expect(spellingDistance('popul', 'popular', false)).toBe(2);
	});
});
