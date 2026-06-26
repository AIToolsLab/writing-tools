/**
 * Propose — the pessimistic interaction model.
 *
 * The model never touches the document on its own. Each edit is staged as a
 * proposal with a preview; nothing changes until the writer accepts. Consent is
 * *prior* and *explicit*. The writer is a gate the pen must pass — maximum
 * control, at the cost of turning collaboration into review.
 *
 * Mechanically, the staged edit's tool call is left *open* in the model's
 * history: the writer's accept/decline becomes its tool result, so the model
 * literally learns the verdict before its next move. Contrast with Walkthrough,
 * which applies first and lets the writer react.
 */

import {
	advanceToDecision,
	applyOpAndReport,
	locateProposal,
	validateOp,
} from '../shared';
import type { InteractionStrategy, PendingProposal } from '../types';

export function createProposeStrategy(): InteractionStrategy {
	// Survives between calls: the edit awaiting the writer's verdict.
	let pending: PendingProposal | null = null;

	return {
		name: 'Propose',
		blurb:
			'Pessimistic — nothing changes until you accept. Each edit is a proposal you approve or decline.',

		async run(input, ctx) {
			// Resolve any standing proposal first — this also delivers the verdict
			// as the open edit's tool result, so the model can react to it.
			if (pending) {
				if (input.type === 'accept') {
					const result = await applyOpAndReport(ctx, pending.op);
					ctx.responder.recordToolResult(
						result.ok
							? `The writer ACCEPTED. ${result.report}`
							: `The writer accepted, but ${result.report}`,
					);
				} else if (input.type === 'reject') {
					ctx.responder.recordToolResult(
						`The writer DECLINED: ${pending.summary}. Try a different move or ask what they'd prefer.`,
					);
				} else if (input.type === 'message') {
					ctx.responder.recordToolResult(
						`The writer set the proposal aside and said: "${input.text}"`,
					);
				} else {
					ctx.responder.recordToolResult('The writer moved on.');
				}
				pending = null;
			} else if (input.type === 'message') {
				ctx.responder.pushWriter(input.text);
			} else {
				ctx.responder.pushWriter('ok.');
			}

			for (let attempt = 0; attempt < 2; attempt++) {
				const move = await advanceToDecision(ctx);
				const action = move.action;

				if (!action || action.tool !== 'edit') {
					return {
						caption: move.say ?? '…',
						awaiting: 'message',
						pending: null,
					};
				}

				const v = validateOp(action.op, await ctx.corpus());
				if (!v.ok) {
					ctx.responder.recordToolResult(
						`REJECTED: "${v.offending}" is not in the writer's words.`,
					);
					continue;
				}

				// Stage without applying. Point at the spot in the document so the
				// writer can see *where* before deciding, and leave the tool call
				// open: the writer's next decision becomes its result.
				const { highlight, summary } = await locateProposal(
					ctx.editor,
					action.op,
				);
				if (highlight) {
					try {
						await ctx.editor.selectPhrase(highlight);
					} catch {
						/* best-effort: the doc may not contain it verbatim */
					}
				}
				pending = { op: action.op, summary, say: move.say ?? summary };
				return {
					caption: pending.say,
					awaiting: 'decision',
					pending,
				};
			}

			return {
				caption: 'What would you like me to try?',
				awaiting: 'message',
				pending: null,
			};
		},
	};
}
