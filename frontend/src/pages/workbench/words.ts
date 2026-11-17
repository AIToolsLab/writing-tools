/**
 * What counts as a word in a suggestion. Ported from AIToolsLab/writing-prototypes
 * `docs/llm.js` and `docs/engine-tokens.js`.
 *
 * Suggestions are words, never punctuation (as phone keyboards do): a unit of n
 * words ends early at punctuation, and a continuation that starts with
 * punctuation offers nothing. Apostrophes and hyphens inside a word are part of
 * it, and so is other punctuation between letters ("U.S.", "e.g.", "1,000",
 * "and/or").
 *
 * {@link wordUnitPattern} is also sent to the server as its `stop` regex, so
 * the server's idea of a distinct unit (what `units` counts) matches the
 * client's grouping. It must mean the same in JavaScript and in C++'s
 * ECMAScript regexes, which see bytes: hence alternations, not character
 * classes, for the non-ASCII marks.
 */

const PUNCT = '[.,;:!?"()\\[\\]{}*<>`]|…|—|–|“|”'; // * < > ` for Markdown and HTML
const WORD_START = `(?:(?!${PUNCT}|-)\\S)`;
const WORD_CHAR = `(?:(?!${PUNCT})\\S)`;
// Punctuation inside a word is part of it: "U.S." and "e.g." (dots between
// letters, and the last one), "1,000", "and/or".
const WORD = `(?:(?:${WORD_START}${WORD_CHAR}*\\.){2,}|${WORD_START}(?:${WORD_CHAR}|[.,:/](?=${WORD_START}))*)`;

/**
 * Matches the first n words when they're known to be whole (followed by
 * whitespace, or by punctuation that isn't inside a word, which takes seeing
 * what follows it), or just the leading whitespace when the text starts with
 * punctuation. Whitespace first, so "U.S. law" isn't cut at "U.S".
 */
export function wordUnitPattern(n: number): string {
	return (
		`^\\s*${WORD}(?:[ \\t]+${WORD}){${n - 1}}(?=\\s)` +
		`|^\\s*${WORD}(?:[ \\t]+${WORD}){0,${n - 1}}(?=(?:${PUNCT})(?:\\s|${PUNCT}))` +
		`|^\\s*(?=${PUNCT}|-)`
	);
}

/**
 * The first n words of text, if text already shows where they end; else null.
 * "" if it starts with punctuation.
 */
export function completeWords(text: string, n: number): string | null {
	const match = text.match(new RegExp(wordUnitPattern(n)));
	return match ? match[0] : null;
}

/** Leading whitespace plus up to the first n words, which may still be growing. */
export function firstWords(text: string, n: number): string {
	const match = text.match(
		new RegExp(`^\\s*${WORD}(?:[ \\t]+${WORD}){0,${n - 1}}`),
	);
	return match ? match[0] : '';
}

// Scripts written without spaces between words. For these, words come from
// the browser's segmenter, and the server is asked for a few characters
// rather than "up to the next space".
export const NO_SPACE_SCRIPT =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const segmenter =
	typeof Intl !== 'undefined' && Intl.Segmenter
		? new Intl.Segmenter(undefined, { granularity: 'word' })
		: null;

/**
 * The first n words of a continuation, and whether there's enough text after
 * them to know they're whole.
 */
export function firstUnits(
	text: string,
	n: number,
): { text: string; complete: boolean } {
	if (!segmenter || !NO_SPACE_SCRIPT.test(text)) {
		const whole = completeWords(text, n);
		return whole === null
			? { text: firstWords(text, n), complete: false }
			: { text: whole, complete: true };
	}
	// A unit is a word plus any punctuation after it; it ends at whitespace or
	// where the next word starts.
	const segments = [...segmenter.segment(text)];
	let count = 0;
	let end = 0;
	let i = 0;
	for (; i < segments.length; i++) {
		const { segment, isWordLike } = segments[i];
		if (count === n && (isWordLike || /\s/.test(segment))) break;
		if (isWordLike) count++;
		end = segments[i].index + segment.length;
	}
	// The last segment may be a word that's still growing, so it doesn't
	// confirm that the unit ended.
	const complete =
		count === n &&
		(i < segments.length - 1 ||
			(i < segments.length && /\s/.test(segments[i].segment)));
	return { text: text.slice(0, end), complete };
}

/**
 * Edits (insert, delete, substitute, swap two neighbors) to turn a into b; or,
 * if `prefix`, into whichever start of b is closest (a is a word still being
 * typed).
 */
export function spellingDistance(
	a: string,
	b: string,
	prefix: boolean,
): number {
	const d = Array.from({ length: a.length + 1 }, (_, i) =>
		Array.from({ length: b.length + 1 }, (_, j) =>
			i === 0 ? j : j === 0 ? i : 0,
		),
	);
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			d[i][j] = Math.min(
				d[i - 1][j] + 1,
				d[i][j - 1] + 1,
				d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			if (
				i > 1 &&
				j > 1 &&
				a[i - 1] === b[j - 2] &&
				a[i - 2] === b[j - 1]
			) {
				d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
			}
		}
	}
	return prefix ? Math.min(...d[a.length]) : d[a.length][b.length];
}
