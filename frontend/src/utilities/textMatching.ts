/**
 * Tolerant text matching for locating a phrase in the writer's document.
 *
 * Every tool that acts on the writer's words — `str_replace`, `insert … after`,
 * `move`, `highlight` — has to find a phrase the *model* uttered inside text the
 * *host* stores, and those two strings disagree far more often than they look
 * like they should. Word autocorrects `-` into an en dash and `'` into a curly
 * apostrophe as the writer types; speech transcription emits straight ASCII;
 * copy-paste brings non-breaking spaces; a writer types two spaces after a
 * period and the model repeats the sentence with one; and hyphenation is simply
 * unstable across sources ("well-being" / "well being"). A plain `indexOf` reads
 * every one of those as "not found", so an edit the model got *right* fails and
 * it burns the turn re-`view`ing.
 *
 * So matching runs a ladder, most literal first, and stops at the first tier
 * that hits document-wide. Exact text always wins over a folded match anywhere
 * else, so leniency only ever rescues a search that would otherwise have failed
 * outright:
 *
 *   1. **exact** — byte-for-byte.
 *   2. **typographic** — dashes, quotes and exotic spaces canonicalized;
 *      invisible characters (soft hyphen, zero-width, BOM) dropped.
 *   3. **loose** — the above, plus case-folding, runs of spaces collapsed to
 *      one, and a hyphen treated as a space, which is what makes "well-being"
 *      find "well being" and vice versa.
 *
 * Deliberately *not* folded: newlines (they're paragraph boundaries, and the
 * callers rely on that coordinate system), and the gap between a hyphenated and
 * a closed compound ("e-mail" / "email"). The latter would mean matching across
 * deleted separators, and a wrong match silently rewrites the writer's prose —
 * worse than a clean miss the model can retry.
 *
 * A fold may drop or merge characters, so it carries an index map back to the
 * source: a hit at folded `[a, b)` is the source range `[srcIndex(f, a),
 * srcIndex(f, b))`. Callers slice the *original* text with those, so what gets
 * replaced or selected is always the writer's real characters.
 */

/** Folded text plus, when it isn't 1:1, the source index of each folded char. */
export interface Folded {
	text: string;
	/**
	 * `map[i]` is the source index of folded character `i`, and `map[text.length]`
	 * is the source length. Absent for the identity fold, where they're equal.
	 */
	map?: number[];
}

/** Where folded index `i` sits in the source text. */
export function srcIndex(folded: Folded, i: number): number {
	return folded.map ? folded.map[i] : i;
}

/** Characters that carry no text, only layout hints from some other editor. */
const DROPPED = new Set([
	'­', // soft hyphen
	'​', // zero-width space
	'‌', // zero-width non-joiner
	'‍', // zero-width joiner
	'﻿', // BOM / zero-width no-break space
]);

/** One-for-one canonicalization: typographic variants → their ASCII form. */
const CANON: Record<string, string> = {
	// dashes and hyphens
	'‐': '-', // hyphen
	'‑': '-', // non-breaking hyphen
	'‒': '-', // figure dash
	'–': '-', // en dash
	'—': '-', // em dash
	'―': '-', // horizontal bar
	'−': '-', // minus sign
	'－': '-', // fullwidth hyphen-minus
	// apostrophes and single quotes
	'‘': "'",
	'’': "'",
	'‚': "'",
	'‛': "'",
	ʼ: "'",
	'´': "'",
	'`': "'",
	// double quotes
	'“': '"',
	'”': '"',
	'„': '"',
	'‟': '"',
	// spaces (never \n or \r — those are paragraph structure)
	'\t': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	' ': ' ',
	'　': ' ',
};

/** Lowercase a single character, unless casing would change its length. */
function lowerChar(ch: string): string {
	const lower = ch.toLowerCase();
	return lower.length === 1 ? lower : ch;
}

/**
 * Build a fold. `loose` adds case-folding, hyphen-as-space, and whitespace
 * collapsing on top of the typographic canonicalization.
 */
function makeFold(loose: boolean): (source: string) => Folded {
	return (source) => {
		let text = '';
		const map: number[] = [];
		let prevWasSpace = false;
		for (let i = 0; i < source.length; i++) {
			const ch = source[i];
			if (DROPPED.has(ch)) continue;
			let out = CANON[ch] ?? ch;
			if (loose) {
				// A hyphen is a word separator like any other here, so a
				// compound matches however either side spelled it.
				out = out === '-' ? ' ' : lowerChar(out);
				// Runs of spaces collapse to one; the run maps to its first
				// character, so the source span still covers all of it.
				if (out === ' ' && prevWasSpace) continue;
			}
			prevWasSpace = out === ' ';
			map.push(i);
			text += out;
		}
		map.push(source.length);
		return { text, map };
	};
}

/**
 * The leniency ladder, most literal first. Apply one tier across the *whole*
 * search space before moving to the next, so an exact match anywhere beats a
 * folded match somewhere else.
 */
export const MATCH_FOLDS: readonly ((source: string) => Folded)[] = [
	(source) => ({ text: source }),
	makeFold(false),
	makeFold(true),
];

/**
 * Locate `needle` in `hay` under the ladder, as a source-index range. For
 * single-haystack callers; anything searching several strings (paragraphs,
 * text nodes) should loop the tiers itself so a whole tier is exhausted first.
 */
export function findPhrase(
	hay: string,
	needle: string,
): { start: number; end: number } | null {
	for (const fold of MATCH_FOLDS) {
		const folded = fold(hay);
		const foldedNeedle = fold(needle).text;
		const at = folded.text.indexOf(foldedNeedle);
		if (at === -1) continue;
		return {
			start: srcIndex(folded, at),
			end: srcIndex(folded, at + foldedNeedle.length),
		};
	}
	return null;
}
