/**
 * Compact previews of a proposed edit: just the changed span, with a few words
 * of context on each side, so an approval card stays short however long the
 * paragraph is.
 *
 * TODO: once document text is represented as Markdown, a trimmed span can cut
 * through formatting (half of a `**bold**`); trim at Markdown-aware boundaries
 * then.
 */

import { lowerOp } from './ops';
import type { EditOp } from './types';

export interface ChangePreview {
	/** Unchanged context before the change, already clipped. */
	before: string;
	removed: string;
	added: string;
	/** Unchanged context after the change, already clipped. */
	after: string;
	/** Whether `before`/`after` were clipped (render an ellipsis). */
	clippedBefore: boolean;
	clippedAfter: boolean;
	/** The full old and new text, for "show whole paragraph". */
	fullOld: string;
	fullNew: string;
}

/** Index of the start of the word containing `i` (or `i` itself at a boundary). */
function wordStart(text: string, i: number): number {
	while (i > 0 && !/\s/.test(text[i - 1])) i--;
	return i;
}

/** Index just past the end of the word containing `i - 1`. */
function wordEnd(text: string, i: number): number {
	while (i < text.length && !/\s/.test(text[i])) i++;
	return i;
}

/** The changed span between two texts, whole words, with `contextWords` around. */
export function previewChange(
	oldText: string,
	newText: string,
	contextWords = 6,
): ChangePreview {
	const max = Math.min(oldText.length, newText.length);
	let prefix = 0;
	while (prefix < max && oldText[prefix] === newText[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < max - prefix &&
		oldText[oldText.length - 1 - suffix] ===
			newText[newText.length - 1 - suffix]
	)
		suffix++;

	// Widen the change to whole words, the same amount in both texts (the
	// prefix and suffix are shared, so snapping against the old text is enough
	// to keep them shared).
	const start = wordStart(oldText, prefix);
	const oldEnd = Math.max(start, wordEnd(oldText, oldText.length - suffix));
	const tail = oldText.length - oldEnd;
	const newEnd = newText.length - tail;

	const head = oldText.slice(0, start);
	const rest = oldText.slice(oldEnd);
	const beforeMatch = new RegExp(`(?:\\S+\\s+){0,${contextWords}}$`).exec(head);
	const afterMatch = new RegExp(`^(?:\\s*\\S+){0,${contextWords}}`).exec(rest);
	const before = beforeMatch ? beforeMatch[0] : '';
	const after = afterMatch ? afterMatch[0] : '';

	return {
		before,
		removed: oldText.slice(start, oldEnd),
		added: newText.slice(start, newEnd),
		after,
		clippedBefore: before.length < head.length,
		clippedAfter: after.length < rest.length,
		fullOld: oldText,
		fullNew: newText,
	};
}

/**
 * Previews for each part of an op against the current document (a `move` has
 * two: where the passage leaves and where it lands). Throws if the op doesn't
 * apply, like `lowerOp`.
 */
export function previewOpChanges(
	paragraphs: string[],
	op: EditOp,
	contextWords?: number,
): ChangePreview[] {
	return lowerOp(paragraphs, op).map((splice) =>
		previewChange(
			splice.remove.join('\n'),
			splice.insert.join('\n'),
			contextWords,
		),
	);
}
