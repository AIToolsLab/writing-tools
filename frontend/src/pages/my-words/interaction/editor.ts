/**
 * Apply an `EditOp` through the host-agnostic `EditorAPI`.
 *
 * The real Office/Google editors only know `str_replace` and `insert`
 * (`DocEdit`), so `move` is composed from a delete + an insert here. The
 * in-memory mock editor implements the same two primitives, so this one helper
 * drives every host.
 */

import type { EditOp } from './types';

export async function applyEditOp(
	editor: EditorAPI,
	op: EditOp,
): Promise<void> {
	switch (op.kind) {
		case 'str_replace':
			await editor.applyEdit({
				type: 'str_replace',
				oldStr: op.oldStr,
				newStr: op.newStr,
				paragraph: op.paragraph,
			});
			return;
		case 'insert':
			await editor.applyEdit({
				type: 'insert',
				text: op.text,
				after: op.after,
				paragraph: op.paragraph,
				position: op.position,
			});
			return;
		case 'move':
			// Lift the phrase out (delete), then drop it at the target. Adds no
			// words — the phrase is already the writer's.
			await editor.applyEdit({
				type: 'str_replace',
				oldStr: op.phrase,
				newStr: '',
			});
			await editor.applyEdit({
				type: 'insert',
				text: op.phrase,
				paragraph: op.paragraph,
				position: op.position ?? 'after',
			});
			return;
	}
}
