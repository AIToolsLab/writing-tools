/**
 * Turn primitives shared by the interaction strategies.
 *
 * The strategies differ in *what they do with an edit* (apply now vs. stage for
 * consent); everything before that — pumping the model through read-only moves
 * like `view` and `highlight`, validating against the word-bank, describing the
 * result — is common and lives here.
 */

import { validateText, type Corpus } from '../corpus';
import type { AssistantMove, EditOp, Responder, StrategyContext } from './types';

/** Render the document for the `view` tool: paragraphs numbered [1], [2], … */
export async function viewText(editor: EditorAPI): Promise<string> {
	const paragraphs = await editor.getParagraphs();
	if (!paragraphs.some((p) => p.trim().length > 0))
		return '(the document is empty)';
	return paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n');
}

/** A brief, post-edit confirmation the model can use to track the doc. */
export async function describeChange(editor: EditorAPI): Promise<string> {
	const n = (await editor.getParagraphs()).length;
	return `Applied. The document now has ${n} paragraph(s); numbers may have shifted — \`view\` before your next placement.`;
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

/**
 * Pump the model through read-only moves (`view`, `highlight`) — which are not
 * commitments — until it produces something a strategy must decide on: an
 * `edit`, or pure speech. Read-only results are fed back so the model can react.
 * Capped so a confused model can't spin forever.
 */
export async function advanceToDecision(
	ctx: StrategyContext,
	maxSteps = 6,
): Promise<AssistantMove> {
	for (let i = 0; i < maxSteps; i++) {
		const move = await ctx.responder.next();
		if (move.say) ctx.setCaption(move.say);

		const action = move.action;
		if (!action) return move; // pure speech: floor passes back
		if (action.tool === 'edit') return move; // a commitment to decide on

		if (action.tool === 'view') {
			ctx.responder.recordToolResult(await viewText(ctx.editor));
			continue;
		}
		if (action.tool === 'highlight') {
			try {
				await ctx.editor.selectPhrase(action.phrase);
				ctx.responder.recordToolResult('Highlighted.');
			} catch {
				ctx.responder.recordToolResult(
					`Could not find "${action.phrase}".`,
				);
			}
			continue;
		}
	}
	// Hit the cap: nudge the model to speak next turn.
	return { say: 'Let me know how you’d like to proceed.' };
}
