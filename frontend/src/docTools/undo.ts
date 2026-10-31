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
 * Splices that expect nothing (`remove: []`, e.g. restoring a paragraph a
 * `move` emptied) can't be checked or relocated, so they go back at their
 * recorded index. The whole sequence is dry-run on a copy first, so an undo
 * either applies completely or not at all.
 */

import { applySpliceToEditor } from './editor';
import { applySplice, spliceIsFresh } from './ops';

/** Where `splice.remove` sits in `paragraphs` now, or null if not exactly once. */
export function locateSplice(
	paragraphs: string[],
	splice: ParagraphSplice,
): number | null {
	if (spliceIsFresh(paragraphs, splice)) return splice.index;
	if (splice.remove.length === 0) return null;
	const found: number[] = [];
	for (let i = 0; i + splice.remove.length <= paragraphs.length; i++) {
		if (spliceIsFresh(paragraphs, { ...splice, index: i })) found.push(i);
	}
	return found.length === 1 ? found[0] : null;
}

/**
 * The undo splices re-anchored to the document as it is now, or null if the
 * edit's text has changed since (so undoing would overwrite the writer).
 */
export function planUndo(
	paragraphs: string[],
	undo: ParagraphSplice[],
): ParagraphSplice[] | null {
	const planned: ParagraphSplice[] = [];
	let current = paragraphs;
	for (const splice of undo) {
		const index = locateSplice(current, splice);
		if (index === null) return null;
		const anchored = { ...splice, index };
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
	undo: ParagraphSplice[],
): Promise<void> {
	const planned = planUndo(await editor.getParagraphs(), undo);
	if (!planned) throw new UndoConflict();
	for (const splice of planned) await applySpliceToEditor(editor, splice);
}
