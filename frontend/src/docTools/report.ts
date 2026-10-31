/**
 * What the model reads back from the document tools: the numbered `view`, the
 * post-apply report, the word-bank check, and the human-readable description
 * of a proposed edit.
 */

import { validateText, type Corpus } from './corpus';
import { applyEditOp } from './editor';
import { describeOp } from './ops';
import type { EditOp } from './types';

const clip = (s: string, n = 40) =>
	s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * For a staged edit, decide what to point at in the document and how to describe
 * the change so the writer can see *where* before deciding. We highlight one end
 * (the change site, or the destination for inserts/moves) and name the other end
 * in the summary, so source and destination are both concrete.
 */
export async function locateProposal(
	editor: EditorAPI,
	op: EditOp,
): Promise<{ highlight?: string; summary: string }> {
	if (op.kind === 'str_replace') {
		// The site IS the source span — point there; the summary shows old → new.
		return { highlight: op.oldStr, summary: describeOp(op) };
	}

	const where = (op.position ?? 'after') === 'before' ? 'before' : 'after';

	if (op.kind === 'insert') {
		if (op.after !== undefined) {
			return {
				highlight: op.after,
				summary: `Add “${clip(op.text)}” after “${clip(op.after)}”`,
			};
		}
		if (op.paragraph !== undefined) {
			const target =
				(await editor.getParagraphs())[op.paragraph - 1] ?? '';
			return {
				highlight: target || undefined,
				summary: target
					? `Add “${clip(op.text)}” ${where} “${clip(target)}”`
					: `Add “${clip(op.text)}”`,
			};
		}
		return { summary: `Add “${clip(op.text)}” at the end` };
	}

	// move: point at the destination (the "new spot"); name the source phrase.
	const target = (await editor.getParagraphs())[op.paragraph - 1] ?? '';
	return {
		highlight: target || undefined,
		summary: target
			? `Move “${clip(op.phrase)}” ${where} “${clip(target)}”`
			: `Move “${clip(op.phrase)}”`,
	};
}

/**
 * Render paragraphs for the `view` tool, numbered [1], [2], … Pure so the
 * scratchpad (an array of lines) can use it too.
 */
export function viewParagraphs(
	paragraphs: string[],
	emptyLabel = '(the document is empty)',
): string {
	if (!paragraphs.some((p) => p.trim().length > 0)) return emptyLabel;
	// Skip blank paragraphs (they burn tokens), but keep each kept paragraph's
	// real 1-based number so `insert`/`move` targeting still lines up.
	return paragraphs
		.map((p, i) => ({ n: i + 1, text: p }))
		.filter((x) => x.text.trim().length > 0)
		.map((x) => `[${x.n}] ${x.text}`)
		.join('\n');
}

/** Render the document for the `view` tool: paragraphs numbered [1], [2], … */
export async function viewText(editor: EditorAPI): Promise<string> {
	return viewParagraphs(await editor.getParagraphs());
}

/**
 * A numbered window of paragraphs (each clipped) around a center paragraph, or
 * everything if no center is given. Used to re-orient the model after an edit
 * lands or fails — cheaper than a full `view`. Pure; see `windowAround` for the
 * editor-backed wrapper.
 */
export function numberedWindow(
	paragraphs: string[],
	center?: number,
	radius = 1,
	clipLen = 80,
): string {
	const total = paragraphs.length;
	let lo = 0;
	let hi = total - 1;
	if (center !== undefined) {
		lo = Math.max(0, center - 1 - radius);
		hi = Math.min(total - 1, center - 1 + radius);
	}
	return paragraphs
		.slice(lo, hi + 1)
		.map((p, i) => `[${lo + i + 1}] ${clip(p, clipLen)}`)
		.join('\n');
}

/** The text an op introduces, used to locate where the change landed. */
function probeFor(op: EditOp): string {
	if (op.kind === 'str_replace') return op.newStr;
	if (op.kind === 'insert') return op.text;
	return op.phrase;
}

/**
 * The post-apply report the model reads: a brief confirmation plus a clipped
 * window around where the change landed — never the full text (token cost).
 * `surface` names the document or the scratchpad.
 */
export function appliedReport(
	paragraphs: string[],
	op: EditOp,
	surface = 'document',
): string {
	const probe = probeFor(op).trim().slice(0, 40);
	const center =
		paragraphs.findIndex((p) => probe && p.includes(probe)) + 1 ||
		undefined;
	return `Applied. The ${surface} now has ${paragraphs.length} paragraph(s); numbers may have shifted. Around the change:\n${numberedWindow(paragraphs, center)}`;
}

/** The paragraph an op targets, if it carries one. */
function targetParagraph(op: EditOp): number | undefined {
	if (op.kind === 'str_replace') return op.paragraph;
	return 'paragraph' in op ? op.paragraph : undefined;
}

/**
 * Apply an edit and report back to the model. On success, a brief confirmation
 * plus a window around where it landed (so it can track number shifts). On
 * failure — e.g. the writer moved a paragraph and the cached number is stale —
 * the error plus a window of the current nearby paragraphs, so the model can
 * re-orient and retry instead of flying blind.
 */
export async function applyOpAndReport(
	editor: EditableEditorAPI,
	op: EditOp,
): Promise<{ ok: boolean; report: string }> {
	try {
		await applyEditOp(editor, op);
		return {
			ok: true,
			report: appliedReport(await editor.getParagraphs(), op),
		};
	} catch (e) {
		const window = numberedWindow(
			await editor.getParagraphs(),
			targetParagraph(op),
			2,
		);
		return {
			ok: false,
			report: `Could not apply that: ${(e as Error).message} The document may have changed since you last looked. Current paragraphs near there:\n${window}\nRe-check the numbers (or \`view\`) and try again.`,
		};
	}
}

/** Is the text an edit would introduce drawn entirely from the writer's words? */
export function validateOp(
	op: EditOp,
	corpus: Corpus,
): { ok: boolean; offending?: string } {
	// `move` relocates existing words, so it introduces nothing new.
	if (op.kind === 'move') return { ok: true };
	const text = op.kind === 'str_replace' ? op.newStr : op.text;
	const res = validateText(text, corpus);
	return { ok: res.ok, offending: res.offending };
}
