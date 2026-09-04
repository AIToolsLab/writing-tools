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
 * unstable across sources ("well-being" / "well being" / "wellbeing"). A plain
 * `indexOf` reads every one of those as "not found", so an edit the model got
 * *right* fails and it burns the turn re-`view`ing.
 *
 * So matching runs a ladder, most literal first, and stops at the first tier
 * that hits across the whole search space. Exact text always wins over a folded
 * match anywhere else, so leniency only ever rescues a search that would
 * otherwise have failed outright:
 *
 *   1. **exact** — byte-for-byte.
 *   2. **typographic** — dashes, quotes and exotic spaces canonicalized;
 *      invisible characters (soft hyphen, zero-width, BOM) dropped.
 *   3. **loose** — the above, plus case-folding, runs of spaces collapsed to
 *      one, and a hyphen treated as a space: "well-being" finds "well being".
 *   4. **run-together** — separators dropped entirely, so "email" finds
 *      "e-mail". This tier alone is *word-bounded*: the hit must begin and end
 *      on a word boundary in the source. Without that, "email" also matches
 *      inside "the ache mail", and the span silently rewrites the wrong text.
 *      Gluing across a word gap is the one fold that can find a match no reader
 *      would call the same phrase, so it's the one that needs the anchor.
 *
 * ## Why substitute by category rather than strip punctuation
 *
 * Tempting shortcut: normalize by dropping everything non-alphanumeric. It
 * breaks two things. Punctuation is *editable content* here — `str_replace` is
 * routinely used to change a comma to a period — so a locator that can't see
 * punctuation can't tell whether a trailing `.` is inside the match or after it,
 * and the span it returns eats or drops a character of the writer's prose. And
 * it collapses the ladder: if the second rung already ignored all punctuation,
 * there is nothing between "byte-exact" and "maximally lenient", so a curly-quote
 * mismatch would be resolved at the same leniency as ignoring a sentence
 * boundary. What the sources actually disagree about is *which glyph* they used
 * for one character, so the fix is a same-length substitution, not an erasure.
 *
 * The substitutions come from Unicode general categories (`\p{Pd}` dashes,
 * `\p{Zs}` spaces, `\p{Cf}` invisibles) rather than a hand-listed table, so a
 * dash variant nobody thought of can't go missing. Quotes stay explicit: their
 * categories (`Pi`/`Pf`) don't distinguish single from double, and mapping both
 * to one character would make `'` match `"`.
 *
 * Deliberately *not* folded: newlines (they're paragraph boundaries, and the
 * callers rely on that coordinate system) and accents (é vs e is a different
 * word, not a different rendering of one).
 *
 * A fold may drop or merge characters, so it carries an index map back to the
 * source: a hit at folded `[a, b)` is the source range `[srcIndex(f, a),
 * endIndex(f, b))`. Callers slice the *original* text with those, so what gets
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

/** Where folded index `i` starts in the source text. */
export function srcIndex(folded: Folded, i: number): number {
	if (!folded.map) return i;
	return folded.map[i];
}

/**
 * One past the last source character of a match ending at folded index `i` —
 * *not* `srcIndex(f, i)`, which points at the next character the fold kept and
 * would swallow any dropped characters sitting in between. For "send an e-mail
 * now" that's the difference between a span of `e-mail` and one of `e-mail `.
 */
export function endIndex(folded: Folded, i: number): number {
	if (!folded.map) return i;
	return i === 0 ? folded.map[0] : folded.map[i - 1] + 1;
}

/** Invisible formatting characters: soft hyphen, zero-widths, BOM, bidi marks. */
const INVISIBLE = /\p{Cf}/u;
/** Dash punctuation, plus the minus sign (which is math, not punctuation). */
const DASH = /[\p{Pd}−]/u;
/** Space separators, plus the tab. */
const SPACE = /[\p{Zs}\t]/u;

// Quote folding stays enumerated: `\p{Pi}`/`\p{Pf}` cover both single and double
// curly quotes without telling them apart, so a category-wide rule would fold
// `'` and `"` together.
const SINGLE_QUOTE = new Set(['‘', '’', '‚', '‛', '′', 'ʼ', '´', '`']);
const DOUBLE_QUOTE = new Set(['“', '”', '„', '‟', '″']);

/** Lowercase a single character, unless casing would change its length. */
function lowerChar(ch: string): string {
	const lower = ch.toLowerCase();
	return lower.length === 1 ? lower : ch;
}

/** The typographic canonical form of one character (always 1:1). */
function canon(ch: string): string {
	if (DASH.test(ch)) return '-';
	if (SPACE.test(ch)) return ' ';
	if (SINGLE_QUOTE.has(ch)) return "'";
	if (DOUBLE_QUOTE.has(ch)) return '"';
	return ch;
}

interface FoldOptions {
	/** Case-fold, treat a hyphen as a space, and collapse runs of spaces. */
	loose?: boolean;
	/** Drop separators (spaces and hyphens) outright: "e-mail" → "email". */
	runTogether?: boolean;
}

function makeFold(opts: FoldOptions): (source: string) => Folded {
	return (source) => {
		let text = '';
		const map: number[] = [];
		let prevWasSpace = false;
		for (let i = 0; i < source.length; i++) {
			const ch = source[i];
			if (INVISIBLE.test(ch)) continue;
			let out = canon(ch);
			if (opts.loose || opts.runTogether) {
				// A hyphen is a word separator like any other here, so a
				// compound matches however either side spelled it.
				out = out === '-' ? ' ' : lowerChar(out);
			}
			if (out === ' ') {
				if (opts.runTogether) continue;
				// Runs of spaces collapse to one; the run maps to its first
				// character, so the source span still covers all of it.
				if (opts.loose && prevWasSpace) continue;
			}
			prevWasSpace = out === ' ';
			map.push(i);
			text += out;
		}
		map.push(source.length);
		return { text, map };
	};
}

/** A rung of the ladder: how to fold, and whether hits must sit on word edges. */
export interface MatchTier {
	fold: (source: string) => Folded;
	/**
	 * Require the hit to begin and end on a word boundary in the source. Only
	 * the separator-dropping tier needs this — it's the only fold that can match
	 * across a gap between words.
	 */
	wordBounded?: boolean;
}

/**
 * The leniency ladder, most literal first. Exhaust one tier across the *whole*
 * search space before moving to the next, so an exact match anywhere beats a
 * folded match somewhere else.
 */
export const MATCH_TIERS: readonly MatchTier[] = [
	{ fold: (source) => ({ text: source }) },
	{ fold: makeFold({}) },
	{ fold: makeFold({ loose: true }) },
	{ fold: makeFold({ runTogether: true }), wordBounded: true },
];

const isWordChar = (ch: string | undefined) =>
	ch !== undefined && /[A-Za-z0-9]/u.test(ch);

/**
 * Every hit of `needle` in `hay` under one tier, in order, as source-index
 * ranges. A generator because callers stop at different points: the first hit
 * per paragraph, or the first that starts inside a scoped paragraph.
 */
export function* tierMatches(
	tier: MatchTier,
	hay: string,
	needle: string,
): Generator<{ start: number; end: number }> {
	const folded = tier.fold(hay);
	const foldedNeedle = tier.fold(needle).text;
	for (
		let at = folded.text.indexOf(foldedNeedle);
		at !== -1;
		at = folded.text.indexOf(foldedNeedle, at + 1)
	) {
		const start = srcIndex(folded, at);
		const end = endIndex(folded, at + foldedNeedle.length);
		if (
			tier.wordBounded &&
			(isWordChar(hay[start - 1]) || isWordChar(hay[end]))
		) {
			continue;
		}
		yield { start, end };
	}
}

/** The first hit of `needle` in `hay` under one tier. */
export function firstMatch(
	tier: MatchTier,
	hay: string,
	needle: string,
): { start: number; end: number } | null {
	for (const hit of tierMatches(tier, hay, needle)) return hit;
	return null;
}

/**
 * Locate `needle` in `hay` under the whole ladder. For single-haystack callers;
 * anything searching several strings (paragraphs, text nodes) should loop the
 * tiers itself so a whole tier is exhausted before loosening.
 */
export function findPhrase(
	hay: string,
	needle: string,
): { start: number; end: number } | null {
	for (const tier of MATCH_TIERS) {
		const hit = firstMatch(tier, hay, needle);
		if (hit) return hit;
	}
	return null;
}
