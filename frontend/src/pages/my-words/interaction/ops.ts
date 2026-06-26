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
 */

import type { EditOp } from './types';

function replaceFirst(
	paragraphs: string[],
	oldStr: string,
	newStr: string,
	paragraph?: number,
): string[] {
	const next = [...paragraphs];
	// Scoped to one paragraph: only that one is eligible.
	if (paragraph !== undefined) {
		const i = paragraph - 1;
		const at = next[i]?.indexOf(oldStr) ?? -1;
		if (at === -1) {
			throw new Error(`"${oldStr}" not found in paragraph ${paragraph}.`);
		}
		next[i] =
			next[i].slice(0, at) + newStr + next[i].slice(at + oldStr.length);
		return next;
	}
	for (let i = 0; i < next.length; i++) {
		const at = next[i].indexOf(oldStr);
		if (at !== -1) {
			next[i] =
				next[i].slice(0, at) + newStr + next[i].slice(at + oldStr.length);
			return next;
		}
	}
	throw new Error(`"${oldStr}" not found in the document.`);
}

function insertParagraph(
	paragraphs: string[],
	text: string,
	paragraph: number,
	position: 'before' | 'after',
): string[] {
	// `paragraph` is 1-based as shown by `view`. Clamp defensively.
	const idx = Math.min(Math.max(paragraph, 1), paragraphs.length || 1) - 1;
	const at = position === 'before' ? idx : idx + 1;
	const next = [...paragraphs];
	next.splice(at, 0, text);
	return next;
}

function insertAfterText(
	paragraphs: string[],
	text: string,
	after: string,
): string[] {
	const next = [...paragraphs];
	for (let i = 0; i < next.length; i++) {
		const at = next[i].indexOf(after);
		if (at !== -1) {
			const cut = at + after.length;
			next[i] = `${next[i].slice(0, cut)}${text}${next[i].slice(cut)}`;
			return next;
		}
	}
	throw new Error(`"${after}" not found in the document.`);
}

/** Apply an op to a paragraph array, returning a new array. Throws on misses. */
export function applyOp(paragraphs: string[], op: EditOp): string[] {
	switch (op.kind) {
		case 'str_replace':
			return replaceFirst(paragraphs, op.oldStr, op.newStr, op.paragraph);
		case 'insert':
			if (op.after !== undefined)
				return insertAfterText(paragraphs, op.text, op.after);
			if (op.paragraph !== undefined)
				return insertParagraph(
					paragraphs,
					op.text,
					op.paragraph,
					op.position ?? 'after',
				);
			// No anchor: append as a new trailing paragraph (cursor-at-end).
			return [...paragraphs, op.text];
		case 'move': {
			// Relocate the writer's own words: lift the phrase out, drop any
			// paragraph the removal emptied, then place it. Adds no new words.
			const removed = replaceFirst(paragraphs, op.phrase, '').filter(
				(p) => p.length > 0,
			);
			return insertParagraph(
				removed,
				op.phrase,
				op.paragraph,
				op.position ?? 'after',
			);
		}
	}
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
