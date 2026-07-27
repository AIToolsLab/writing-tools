/**
 * Pure, host-agnostic document operations over a paragraph array.
 *
 * Both ends of the feature lean on this: the in-memory mock editor applies edits
 * with `applyOp`, and the Propose strategy previews an edit with `previewOp`
 * (same transform, on a copy, plus a summary) so the writer sees exactly what
 * accepting would do. Keeping it pure makes it unit-testable and keeps preview
 * and apply from drifting apart.
 *
 * Paragraphs are the shared coordinate system the `view` tool numbers ([1],
 * [2], …) and that paragraph-targeted inserts index into.
 *
 * Every `EditOp` lowers to the one canonical mutation, a paragraph-range
 * `ParagraphSplice`. Newlines in op text are paragraph breaks: a `\n` in
 * replacement/insert text splits a paragraph, and a `\n` in `oldStr` (or a move
 * phrase) matches across a paragraph boundary, so a replace can merge
 * paragraphs. Runs of newlines count as one break. Splices invert by swapping
 * `remove`/`insert`, which is what undo applies.
 */

import type { EditOp } from './types';

// `ParagraphSplice` — the canonical mutation every op lowers to — is declared
// ambiently in types.d.ts so editor hosts can implement `applySplice` without
// importing from this page.

/** Paragraph-break normalization: runs of newlines are one break. */
const normalizeBreaks = (s: string) =>
	s.replace(/\n+/g, '\n').replace(/^\n|\n$/g, '');

/** Split op text into paragraph parts (`''` stays a single empty part). */
const splitParas = (s: string) => normalizeBreaks(s).split('\n');

/**
 * Locate `needle` in the paragraphs, possibly spanning paragraph boundaries
 * when it contains `\n` (paragraphs match as if joined by single newlines).
 * Returns the span as (paragraph, offset) endpoints. Throws with the same
 * messages `applyOp` has always used.
 */
function findSpan(
	paragraphs: string[],
	rawNeedle: string,
	paragraph?: number,
): {
	startPara: number;
	startOffset: number;
	endPara: number;
	endOffset: number;
} {
	const needle = normalizeBreaks(rawNeedle);
	const scopeMiss = () =>
		new Error(`"${rawNeedle}" not found in paragraph ${paragraph}.`);
	const docMiss = () =>
		new Error(`"${rawNeedle}" not found in the document.`);

	if (!needle.includes('\n')) {
		// Single-paragraph needle: first paragraph containing it (or the scoped one).
		if (paragraph !== undefined) {
			const i = paragraph - 1;
			const at = paragraphs[i]?.indexOf(needle) ?? -1;
			if (at === -1) throw scopeMiss();
			return {
				startPara: i,
				startOffset: at,
				endPara: i,
				endOffset: at + needle.length,
			};
		}
		for (let i = 0; i < paragraphs.length; i++) {
			const at = paragraphs[i].indexOf(needle);
			if (at !== -1)
				return {
					startPara: i,
					startOffset: at,
					endPara: i,
					endOffset: at + needle.length,
				};
		}
		throw docMiss();
	}

	// Cross-paragraph needle: match against the single-newline join and map the
	// hit back to (paragraph, offset) coordinates.
	const joined = paragraphs.join('\n');
	const starts: number[] = [];
	let acc = 0;
	for (const p of paragraphs) {
		starts.push(acc);
		acc += p.length + 1; // +1 for the joining newline
	}
	const paraAt = (offset: number) => {
		let i = starts.length - 1;
		while (i > 0 && starts[i] > offset) i--;
		return i;
	};

	let from = 0;
	if (paragraph !== undefined) {
		const i = paragraph - 1;
		if (i < 0 || i >= paragraphs.length) throw scopeMiss();
		from = starts[i];
	}
	const at = joined.indexOf(needle, from);
	if (at === -1) throw paragraph !== undefined ? scopeMiss() : docMiss();
	if (paragraph !== undefined && paraAt(at) !== paragraph - 1)
		throw scopeMiss();

	const end = at + needle.length;
	const startPara = paraAt(at);
	const endPara = paraAt(end);
	return {
		startPara,
		startOffset: at - starts[startPara],
		endPara,
		endOffset: end - starts[endPara],
	};
}

/** Replace a located span with (possibly multi-paragraph) text, as a splice. */
function spliceForSpan(
	paragraphs: string[],
	span: ReturnType<typeof findSpan>,
	replacement: string,
): ParagraphSplice {
	const prefix = paragraphs[span.startPara].slice(0, span.startOffset);
	const suffix = paragraphs[span.endPara].slice(span.endOffset);
	const parts = splitParas(replacement);
	const insert =
		parts.length === 1
			? [prefix + parts[0] + suffix]
			: [
					prefix + parts[0],
					...parts.slice(1, -1),
					parts[parts.length - 1] + suffix,
				];
	return {
		index: span.startPara,
		remove: paragraphs.slice(span.startPara, span.endPara + 1),
		insert,
	};
}

/** Where a 1-based `paragraph`/`position` insert lands (clamped like `view`). */
function insertionIndex(
	length: number,
	paragraph: number,
	position: 'before' | 'after',
): number {
	const idx = Math.min(Math.max(paragraph, 1), length || 1) - 1;
	return position === 'before' ? idx : idx + 1;
}

/**
 * Lower an op to the splice sequence that implements it. Later splices are
 * computed against the array as earlier ones leave it (only `move` needs two).
 * Throws on misses, before anything is applied.
 */
export function lowerOp(paragraphs: string[], op: EditOp): ParagraphSplice[] {
	switch (op.kind) {
		case 'str_replace':
			return [
				spliceForSpan(
					paragraphs,
					findSpan(paragraphs, op.oldStr, op.paragraph),
					op.newStr,
				),
			];
		case 'insert': {
			if (op.after !== undefined) {
				// Inline insert after anchor text, within its paragraph(s).
				const span = findSpan(paragraphs, op.after);
				const anchored = {
					...span,
					startPara: span.endPara,
					startOffset: span.endOffset,
				};
				return [spliceForSpan(paragraphs, anchored, op.text)];
			}
			const at =
				op.paragraph !== undefined
					? insertionIndex(
							paragraphs.length,
							op.paragraph,
							op.position ?? 'after',
						)
					: paragraphs.length; // no anchor: append at the end
			return [{ index: at, remove: [], insert: splitParas(op.text) }];
		}
		case 'move': {
			// Lift the phrase out; if that empties its paragraph, remove the
			// paragraph itself. Then place the phrase as its own paragraph(s) at
			// the target (numbered against the post-removal array, as `view`
			// would show it after the cut).
			const span = findSpan(paragraphs, op.phrase);
			const cut = spliceForSpan(paragraphs, span, '');
			const emptied = cut.insert.every((p) => p.length === 0);
			const removal: ParagraphSplice = emptied
				? { ...cut, insert: [] }
				: cut;
			const afterCut = applySplice(paragraphs, removal);
			const at = insertionIndex(
				afterCut.length,
				op.paragraph,
				op.position ?? 'after',
			);
			return [
				removal,
				{ index: at, remove: [], insert: splitParas(op.phrase) },
			];
		}
	}
}

/** Apply one splice, returning a new array. */
export function applySplice(
	paragraphs: string[],
	splice: ParagraphSplice,
): string[] {
	const next = [...paragraphs];
	next.splice(splice.index, splice.remove.length, ...splice.insert);
	return next;
}

/** Swap `remove`/`insert`: the splice that undoes this one. */
export function invertSplice(splice: ParagraphSplice): ParagraphSplice {
	return {
		index: splice.index,
		remove: splice.insert,
		insert: splice.remove,
	};
}

/**
 * The splice sequence that undoes `splices` (each inverted, in reverse order).
 * Valid against the post-apply array.
 */
export function invertSplices(splices: ParagraphSplice[]): ParagraphSplice[] {
	return [...splices].reverse().map(invertSplice);
}

/** Does the array still read exactly what this splice expects to replace? */
export function spliceIsFresh(
	paragraphs: string[],
	splice: ParagraphSplice,
): boolean {
	if (
		splice.index < 0 ||
		splice.index + splice.remove.length > paragraphs.length
	)
		return false;
	return splice.remove.every((p, i) => paragraphs[splice.index + i] === p);
}

/** Apply an op to a paragraph array, returning a new array. Throws on misses. */
export function applyOp(paragraphs: string[], op: EditOp): string[] {
	return lowerOp(paragraphs, op).reduce(applySplice, paragraphs);
}

/**
 * Apply an op and also return the splices that undo it (captured now, not
 * re-derived later — the undo stack stores these).
 */
export function applyOpLogged(
	paragraphs: string[],
	op: EditOp,
): { after: string[]; splices: ParagraphSplice[]; undo: ParagraphSplice[] } {
	const splices = lowerOp(paragraphs, op);
	return {
		after: splices.reduce(applySplice, paragraphs),
		splices,
		undo: invertSplices(splices),
	};
}

/** A short, writer-facing description of what an op would do. */
export function describeOp(op: EditOp): string {
	const clip = (s: string, n = 48) =>
		s.length > n ? `${s.slice(0, n - 1)}…` : s;
	switch (op.kind) {
		case 'str_replace':
			return `Change “${clip(op.oldStr)}” → “${clip(op.newStr)}”`;
		case 'insert':
			return `Add “${clip(op.text)}”`;
		case 'move':
			return `Move “${clip(op.phrase)}” to a new spot`;
	}
}

/** Non-mutating preview: the resulting paragraphs plus a one-line summary. */
export function previewOp(
	paragraphs: string[],
	op: EditOp,
): { paragraphs: string[]; summary: string } {
	return { paragraphs: applyOp(paragraphs, op), summary: describeOp(op) };
}
