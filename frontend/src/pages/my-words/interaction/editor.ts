/**
 * Apply an `EditOp` (or a raw `ParagraphSplice`) through the host-agnostic
 * `EditorAPI`.
 *
 * Two things live here:
 *
 * - **Reveal-then-apply.** Before an edit lands, the target location is
 *   selected/highlighted and a short beat passes, so the writer's attention
 *   arrives before the change does (and a veto can cancel it). Restructuring
 *   moves get a longer beat than in-place replacements — commitment latency
 *   scales with the cost of being wrong.
 * - **The splice adapter.** Hosts with a native `applySplice` (the Lexical
 *   editor, the mock) apply paragraph-range splices atomically; other hosts
 *   (Word) get the splice expressed as a sequence of `DocEdit` primitives.
 */

import { lowerOp } from './ops';
import type { EditOp } from './types';

/** Thrown when the writer cancels an edit during the reveal beat. */
export class EditVetoed extends Error {
	constructor() {
		super('The writer cancelled this edit before it was applied.');
		this.name = 'EditVetoed';
	}
}

/** Reveal-beat length by op kind: restructuring gets a longer veto window. */
const REVEAL_MS: Record<EditOp['kind'], number> = {
	str_replace: 750,
	insert: 750,
	move: 1800,
};

export interface ApplyEditOptions {
	/** Override the reveal beat (0 disables it, e.g. scripted playback). */
	revealMs?: number;
	/**
	 * Called when the reveal beat starts, with a `cancel` the UI can wire to a
	 * "✕" chip. Cancelling makes the apply reject with `EditVetoed`.
	 */
	onReveal?: (info: { anchor?: string; cancel: () => void }) => void;
	/** Called when the beat ends (applied or vetoed) so the UI can clear. */
	onRevealEnd?: () => void;
}

export const delay = (ms: number) =>
	new Promise<void>((r) => setTimeout(r, ms));

/** The text to point at so the writer sees *where* before the edit lands. */
export function revealAnchorFor(
	op: EditOp,
	paragraphs: string[],
): string | undefined {
	if (op.kind === 'str_replace') return op.oldStr;
	if (op.kind === 'move') return op.phrase;
	if (op.after !== undefined) return op.after;
	if (op.paragraph !== undefined) return paragraphs[op.paragraph - 1] || undefined;
	return undefined;
}

/**
 * Run the veto window: announce it via `onReveal` (handing the UI a `cancel`),
 * wait `ms`, and report whether the writer cancelled. The reveal itself
 * (selection, panel highlight) is the caller's job — it differs per surface.
 */
export async function vetoWindow(
	ms: number,
	opts: Pick<ApplyEditOptions, 'onReveal' | 'onRevealEnd'>,
	anchor?: string,
): Promise<boolean> {
	let vetoed = false;
	opts.onReveal?.({
		anchor,
		cancel: () => {
			vetoed = true;
		},
	});
	try {
		await delay(ms);
	} finally {
		opts.onRevealEnd?.();
	}
	return vetoed;
}

/**
 * Reveal the edit's location, wait out the veto window, then apply. A missing
 * anchor skips the selection but never blocks the edit. Returns the splices
 * that were applied, so callers can capture their inverses for undo.
 */
export async function applyEditOp(
	editor: EditorAPI,
	op: EditOp,
	opts: ApplyEditOptions = {},
): Promise<ParagraphSplice[]> {
	const revealMs = opts.revealMs ?? REVEAL_MS[op.kind];
	if (revealMs > 0) {
		const anchor = revealAnchorFor(op, await editor.getParagraphs());
		if (anchor) {
			try {
				await editor.selectPhrase(anchor);
			} catch {
				// Anchor not found (numbers shifted, partial phrase): the apply
				// itself will succeed or fail loudly; don't block on the reveal.
			}
		}
		if (await vetoWindow(revealMs, opts, anchor)) throw new EditVetoed();
	}

	// `move` lowers to two splices; apply them as one gesture.
	const splices = lowerOp(await editor.getParagraphs(), op);
	for (const splice of splices) {
		await applySpliceToEditor(editor, splice);
	}
	return splices;
}

/**
 * The shortest str_replace that turns `oldText` into `newText`: trim the
 * common prefix/suffix, then (because hosts can't search for an empty string,
 * and Word's search also caps needle length) extend by one neighboring
 * character if the differing middle is empty.
 */
export function minimalReplace(
	oldText: string,
	newText: string,
): { oldStr: string; newStr: string } {
	let prefix = 0;
	const maxPrefix = Math.min(oldText.length, newText.length);
	while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < maxPrefix - prefix &&
		oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
	)
		suffix++;
	let start = prefix;
	let oldStr = oldText.slice(prefix, oldText.length - suffix);
	let newStr = newText.slice(prefix, newText.length - suffix);
	if (oldStr.length === 0) {
		if (start > 0) {
			start--;
			oldStr = oldText[start];
			newStr = oldText[start] + newStr;
		} else if (suffix > 0) {
			oldStr = oldText[oldText.length - suffix];
			newStr = newStr + oldStr;
		}
	}
	// Hosts replace the FIRST occurrence; grow the needle leftward until the
	// first occurrence is the intended one (e.g. second "aa" in "aa b aa").
	while (start > 0 && oldText.indexOf(oldStr) !== start) {
		start--;
		oldStr = oldText[start] + oldStr;
		newStr = oldText[start] + newStr;
	}
	return { oldStr, newStr };
}

/**
 * Apply one paragraph-range splice to any host. Native `applySplice` when the
 * host has it; otherwise a sequence of `DocEdit` primitives (whole positions
 * replaced via minimal in-paragraph str_replace, growth via paragraph inserts,
 * shrinkage via delete_paragraph).
 */
export async function applySpliceToEditor(
	editor: EditorAPI,
	splice: ParagraphSplice,
): Promise<void> {
	if (editor.applySplice) {
		await editor.applySplice(splice);
		return;
	}
	const { index, remove, insert } = splice;
	const overlap = Math.min(remove.length, insert.length);
	for (let k = 0; k < overlap; k++) {
		if (remove[k] === insert[k]) continue;
		if (remove[k] === '') {
			// An empty paragraph gaining text: hosts can't search for '', so
			// add the text as a fresh paragraph and drop the empty one.
			await editor.applyEdit({
				type: 'insert',
				text: insert[k],
				paragraph: index + k + 1,
				position: 'after',
			});
			await editor.applyEdit({
				type: 'delete_paragraph',
				paragraph: index + k + 1,
			});
			continue;
		}
		const { oldStr, newStr } = minimalReplace(remove[k], insert[k]);
		await editor.applyEdit({
			type: 'str_replace',
			oldStr,
			newStr,
			paragraph: index + k + 1,
		});
	}
	// Shrinkage: delete back-to-front so numbers stay valid.
	for (let k = remove.length - 1; k >= overlap; k--) {
		await editor.applyEdit({
			type: 'delete_paragraph',
			paragraph: index + k + 1,
		});
	}
	// Growth: each insert lands at 0-based position index+k.
	for (let k = overlap; k < insert.length; k++) {
		await editor.applyEdit(
			index + k === 0
				? { type: 'insert', text: insert[k], paragraph: 1, position: 'before' }
				: {
						type: 'insert',
						text: insert[k],
						paragraph: index + k,
						position: 'after',
					},
		);
	}
}
