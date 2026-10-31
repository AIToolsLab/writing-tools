/**
 * Turn primitives shared by the interaction strategies.
 *
 * The strategies differ in *what they do with an edit* (apply now vs. stage for
 * consent); pumping the model through read-only moves like `view` and
 * `highlight` is common and lives here. The document-tool primitives
 * (validation, reports) are in `@/docTools/report`.
 */

import { viewText } from '@/docTools/report';
import type { AssistantMove, StrategyContext } from './types';

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
