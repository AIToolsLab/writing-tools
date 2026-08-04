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

import {
	endIndex,
	findPhrase,
	firstMatch,
	MATCH_TIERS,
	srcIndex,
	tierMatches,
} from '../textMatching';

/** The loosest tier: separators dropped, hits anchored to word boundaries. */
const RUN_TOGETHER = MATCH_TIERS[MATCH_TIERS.length - 1];
const LOOSE = MATCH_TIERS[MATCH_TIERS.length - 2];

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

describe('the run-together tier (closed vs. hyphenated compounds)', () => {
	// Transcription is as unsure about "email" / "e-mail" as it is about
	// "well-being" / "well being": same utterance, and the transcriber picks a
	// spelling that need not be the document's.
	it('matches a closed compound against a hyphenated one', () => {
		expect(matched('send an e-mail now', 'email')).toBe('e-mail');
		expect(matched('send an email now', 'e-mail')).toBe('email');
	});

	it('matches across a space too', () => {
		expect(matched('send an e mail now', 'email')).toBe('e mail');
	});

	it('does not glue across a word gap', () => {
		// The reason this tier is anchored: "the ache mail" contains the letters
		// of "email" across a boundary no reader would call the same phrase, and
		// matching it would splice over the wrong text.
		expect(findPhrase('nursing the ache mail arrived', 'email')).toBeNull();
	});

	it('rejects a hit that starts or ends mid-word', () => {
		// Both of these only match once separators are dropped, and both would
		// splice into the middle of a word.
		expect(firstMatch(RUN_TOGETHER, 'none-mail', 'email')).toBeNull();
		expect(firstMatch(RUN_TOGETHER, 'e-mails', 'email')).toBeNull();
		// …but the same needle is fine where the boundaries are real.
		expect(findPhrase('an e-mail.', 'email')).toEqual({ start: 3, end: 9 });
	});

	it('does not retroactively anchor the exact tier', () => {
		// A needle that appears verbatim inside a longer word still matches, as
		// it always has — the anchor is about what *separator-dropping* may glue
		// together, not a new rule for literal substrings.
		expect(findPhrase('nonemail', 'email')).toEqual({ start: 3, end: 8 });
	});

	it('only anchors the tier that needs it', () => {
		// The looser rungs still allow a partial-word match, exactly as exact
		// `indexOf` always has ("cat" inside "concatenate").
		expect(RUN_TOGETHER.wordBounded).toBe(true);
		expect(LOOSE.wordBounded).toBeFalsy();
		expect(matched('concatenate', 'cat')).toBe('cat');
	});

	it('is reached only after the looser tiers miss', () => {
		// "e-mail" is present verbatim; the run-together tier must not get to
		// re-point the match at the other occurrence.
		expect(findPhrase('an email and an e-mail', 'e-mail')).toEqual({
			start: 16,
			end: 22,
		});
	});
});

describe('fold index maps', () => {
	it('map back to source offsets even when characters are dropped', () => {
		const source = 'a\u00AD  B-c';
		const folded = LOOSE.fold(source);
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
		const folded = LOOSE.fold('The  well-being of “quiet” work');
		for (let i = 1; i <= folded.text.length; i++) {
			expect(srcIndex(folded, i)).toBeGreaterThan(
				srcIndex(folded, i - 1),
			);
		}
	});

	it('leave the exact tier as a plain identity', () => {
		const source = 'well–being';
		expect(MATCH_TIERS[0].fold(source).text).toBe(source);
		expect(srcIndex(MATCH_TIERS[0].fold(source), 4)).toBe(4);
	});

	it('end one past the last matched character, not at the next kept one', () => {
		// `srcIndex` of the end would point past any dropped characters — for
		// "e-mail now" that is the space, and the span would carry it along.
		const source = 'send an e-mail now';
		const folded = RUN_TOGETHER.fold(source);
		const at = folded.text.indexOf('email');
		expect(
			source.slice(srcIndex(folded, at), endIndex(folded, at + 5)),
		).toBe('e-mail');
	});
});

describe('tierMatches', () => {
	it('yields every hit in order, so callers can pick by position', () => {
		const hits = [...tierMatches(MATCH_TIERS[0], 'cat and cat', 'cat')];
		expect(hits).toEqual([
			{ start: 0, end: 3 },
			{ start: 8, end: 11 },
		]);
	});

	it('skips boundary-violating hits rather than stopping at them', () => {
		// The first candidate is mid-word; the tier must keep looking.
		const hits = [
			...tierMatches(RUN_TOGETHER, 'nonemail and e-mail', 'email'),
		];
		expect(hits).toEqual([{ start: 13, end: 19 }]);
	});
});
