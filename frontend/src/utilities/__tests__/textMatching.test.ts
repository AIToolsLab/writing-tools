/**
 * The fold ladder that lets the model's spelling of a phrase find the writer's.
 *
 * Two properties matter here and neither is "it matches more things": that the
 * ladder never *reorders* which occurrence wins (exact beats folded, everywhere),
 * and that a folded hit still maps back to real source offsets — a fold can drop
 * or merge characters, so an off-by-one here would have an edit eat a neighboring
 * character of the writer's prose.
 */

import { describe, expect, it } from 'vitest';

import { findPhrase, MATCH_FOLDS, srcIndex } from '../textMatching';

/** The source text a hit covers — what a caller would replace or select. */
const matched = (hay: string, needle: string) => {
	const hit = findPhrase(hay, needle);
	return hit ? hay.slice(hit.start, hit.end) : null;
};

describe('findPhrase', () => {
	it('matches exactly when it can', () => {
		expect(findPhrase('the cat sat', 'cat')).toEqual({ start: 4, end: 7 });
	});

	it('reports a real miss as a miss', () => {
		expect(findPhrase('the cat sat', 'dog')).toBeNull();
	});

	it('bridges hyphenation in both directions', () => {
		expect(matched('their well-being matters', 'well being')).toBe(
			'well-being',
		);
		expect(matched('their well being matters', 'well-being')).toBe(
			'well being',
		);
	});

	it('splits a hyphen chain the same way', () => {
		expect(matched('a state-of-the-art result', 'state of the art')).toBe(
			'state-of-the-art',
		);
	});

	it('matches across the dash family, not just ASCII hyphens', () => {
		// Word autocorrects a typed hyphen into an en dash.
		expect(matched('a well–being note', 'well-being')).toBe('well–being');
	});

	it('matches a straight apostrophe against a curly one', () => {
		expect(matched('I don’t think so', "don't")).toBe('don’t');
		expect(matched("I don't think so", 'don’t')).toBe("don't");
	});

	it('matches across non-breaking and exotic spaces', () => {
		expect(matched('the\u00A0cat sat', 'the cat')).toBe('the\u00A0cat');
	});

	it('ignores invisible characters in the source', () => {
		// A soft hyphen from a paste; the writer never sees it.
		expect(matched('well\u00ADbeing matters', 'wellbeing')).toBe(
			'well\u00ADbeing',
		);
	});

	it('collapses runs of spaces, so double-spacing is not a miss', () => {
		expect(matched('stop.  Then go', 'stop. Then')).toBe('stop.  Then');
	});

	it('falls back to case-insensitivity last', () => {
		expect(matched('Reproducible research', 'reproducible')).toBe(
			'Reproducible',
		);
	});

	it('prefers an exact hit later in the text over a folded one earlier', () => {
		// The loose tier would match "Cat" at 0; the exact tier must win.
		const hay = 'Cat and cat';
		expect(findPhrase(hay, 'cat')).toEqual({ start: 8, end: 11 });
	});

	it('does not fold a newline into a space', () => {
		// Paragraph structure is the callers' coordinate system; a fold that
		// blurred it would let a same-paragraph needle match across a break.
		expect(findPhrase('one\ntwo', 'one two')).toBeNull();
	});
});

describe('fold index maps', () => {
	it('map back to source offsets even when characters are dropped', () => {
		const loose = MATCH_FOLDS[MATCH_FOLDS.length - 1];
		const source = 'a\u00AD  B-c';
		const folded = loose(source);
		expect(folded.text).toBe('a b c');
		// Every folded index points at the character it came from.
		for (let i = 0; i < folded.text.length; i++) {
			const at = srcIndex(folded, i);
			expect(at).toBeGreaterThanOrEqual(0);
			expect(at).toBeLessThan(source.length);
		}
		expect(srcIndex(folded, folded.text.length)).toBe(source.length);
	});

	it('are monotonic, so a span never inverts', () => {
		const loose = MATCH_FOLDS[MATCH_FOLDS.length - 1];
		const folded = loose('The  well-being of “quiet” work');
		for (let i = 1; i <= folded.text.length; i++) {
			expect(srcIndex(folded, i)).toBeGreaterThan(
				srcIndex(folded, i - 1),
			);
		}
	});

	it('leave the exact tier as a plain identity', () => {
		const exact = MATCH_FOLDS[0];
		const source = 'well–being';
		expect(exact(source).text).toBe(source);
		expect(srcIndex(exact(source), 4)).toBe(4);
	});
});
