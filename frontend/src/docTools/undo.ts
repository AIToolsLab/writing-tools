/**
 * Undo for an applied edit, in any order rather than only the latest.
 *
 * An edit's undo is its splices inverted (`invertSplices`), captured when it
 * was applied. Each inverse names the paragraphs it expects to find (`remove`,
 * the edit's output) and where. Later edits may have shifted that position, so
 * a stale index is relocated to the one place that exact run of paragraphs
 * still occurs; if the run was changed since, or occurs more than once, the
 * undo is refused rather than clobbering the writer's later work.
 *
 * Splices that expect nothing (`remove: []`, e.g. putting back a paragraph a
 * `move` took out) have no text of their own to find, so `captureUndo` records
 * the text on either side of the gap (`prefix`/`suffix`, as in #589's
 * `TextAnchor`) and they're relocated by that, by the same rule: exactly one
 * match, or refuse. The whole sequence is dry-run on a copy first, so an undo
 * either applies completely or not at all.
 */

import { applySpliceToEditor } from './editor';
import { applySplice, invertSplices, spliceIsFresh } from './ops';

/**
 * An undo step. Put-backs (empty `remove`) carry the text around their gap.
 * Kept off `ParagraphSplice`: these are long-lived anchors, not the exact
 * preconditions #589 plans for hosts to check.
 */
export interface UndoSplice extends ParagraphSplice {
	prefix?: string;
	suffix?: string;
}

/** How much text on each side of a gap identifies it. */
const CONTEXT_CHARS = 32;

/**
 * The text just before and after the gap at paragraph `index`, each paragraph
 * ending in a line break, so the window reaches past short or blank
 * paragraphs into real text.
 *
 * Blank paragraphs count literally, so adding or removing a blank line at the
 * spot changes the window and the undo refuses. If `edit_undo_refused` shows
 * that's common (Word writers often space with blank lines), build the window
 * from non-blank paragraphs instead; every slot within one run of blank lines
 * then matches, so take the one nearest the recorded index.
 */
function contextAt(
	paragraphs: string[],
	index: number,
): { prefix: string; suffix: string } {
	let prefix = '';
	for (let i = index - 1; i >= 0 && prefix.length < CONTEXT_CHARS; i--)
		prefix = `${paragraphs[i]}\n${prefix}`;
	let suffix = '';
	for (let i = index; i < paragraphs.length && suffix.length < CONTEXT_CHARS; i++)
		suffix += `${paragraphs[i]}\n`;
	return {
		prefix: prefix.slice(-CONTEXT_CHARS),
		suffix: suffix.slice(0, CONTEXT_CHARS),
	};
}

/** The undo for `splices`, applied to give `after`, with put-backs anchored. */
export function captureUndo(
	after: string[],
	splices: ParagraphSplice[],
): UndoSplice[] {
	let current = after;
	return invertSplices(splices).map((splice) => {
		const anchored =
			splice.remove.length === 0
				? { ...splice, ...contextAt(current, splice.index) }
				: splice;
		current = applySplice(current, splice);
		return anchored;
	});
}

/** Where `splice` applies in `paragraphs` now, or null if not exactly one place. */
export function locateSplice(
	paragraphs: string[],
	splice: UndoSplice,
): number | null {
	if (splice.remove.length === 0) return locateGap(paragraphs, splice);
	if (spliceIsFresh(paragraphs, splice)) return splice.index;
	const found: number[] = [];
	for (let i = 0; i + splice.remove.length <= paragraphs.length; i++) {
		if (spliceIsFresh(paragraphs, { ...splice, index: i })) found.push(i);
	}
	return found.length === 1 ? found[0] : null;
}

/** The one gap between paragraphs with the put-back's recorded context. */
function locateGap(
	paragraphs: string[],
	{ prefix, suffix }: UndoSplice,
): number | null {
	if (prefix === undefined || suffix === undefined) return null;
	const found: number[] = [];
	for (let i = 0; i <= paragraphs.length; i++) {
		// A window cut short by the document's start or end is matched as far
		// as it goes, so text added beyond it doesn't block the undo.
		const at = contextAt(paragraphs, i);
		if (at.prefix.endsWith(prefix) && at.suffix.startsWith(suffix))
			found.push(i);
	}
	return found.length === 1 ? found[0] : null;
}

/**
 * The undo splices re-anchored to the document as it is now, or null if the
 * edit's text has changed since (so undoing would overwrite the writer).
 */
export function planUndo(
	paragraphs: string[],
	undo: UndoSplice[],
): ParagraphSplice[] | null {
	const planned: ParagraphSplice[] = [];
	let current = paragraphs;
	for (const splice of undo) {
		const index = locateSplice(current, splice);
		if (index === null) return null;
		// What the host gets: a plain splice, without the anchoring context.
		const anchored = { index, remove: splice.remove, insert: splice.insert };
		planned.push(anchored);
		current = applySplice(current, anchored);
	}
	return planned;
}

/** Thrown when an edit can't be undone because its text changed since. */
export class UndoConflict extends Error {
	constructor() {
		super('That passage has changed since the edit, so it can’t be undone here.');
		this.name = 'UndoConflict';
	}
}

/** Undo an applied edit. Throws {@link UndoConflict} if it can't be done safely. */
export async function undoEdit(
	editor: EditableEditorAPI,
	undo: UndoSplice[],
): Promise<void> {
	const planned = planUndo(await editor.getParagraphs(), undo);
	if (!planned) throw new UndoConflict();
	for (const splice of planned) await applySpliceToEditor(editor, splice);
}
