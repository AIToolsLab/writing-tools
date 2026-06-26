/**
 * Walkthrough — the optimistic interaction model.
 *
 * Each turn lands at most one edit, immediately, then yields the floor with the
 * model naming the move it would make next. The writer steers a pen that's
 * already moving: a continuer ("ok" / Enter) carries out the teed-up next move,
 * a message redirects. Consent is mostly *post-hoc* (you react to what landed)
 * with the next move consented-to *before* it happens. Feels like co-writing.
 *
 * Contrast with Propose, which never touches the document without prior consent.
 * Same granularity; opposite locus of commitment. See
 * docs/my-words-interaction-design.md.
 */

import { applyEditOp } from '../editor';
import { describeOp } from '../ops';
import {
	advanceToDecision,
	describeChange,
	validateOp,
} from '../shared';
import type { InteractionStrategy } from '../types';

export function createWalkthroughStrategy(): InteractionStrategy {
	return {
		name: 'Walkthrough',
		blurb:
			'Optimistic — edits land as the model goes; you steer, and a tap carries out the next move.',

		async run(input, ctx) {
			ctx.responder.pushWriter(
				input.type === 'message' ? input.text : 'ok — go on.',
			);

			// Up to two attempts to land a *valid* edit; a rejection is fed back so
			// the model can rephrase using the writer's words.
			for (let attempt = 0; attempt < 2; attempt++) {
				const move = await advanceToDecision(ctx);
				const action = move.action;

				if (!action || action.tool !== 'edit') {
					return { caption: move.say ?? '…', awaiting: 'message' };
				}

				const v = validateOp(action.op, await ctx.corpus());
				if (!v.ok) {
					ctx.responder.recordToolResult(
						`REJECTED: "${v.offending}" is not in the writer's words. Use a phrasing of theirs, or ask for the word you need.`,
					);
					continue;
				}

				await applyEditOp(ctx.editor, action.op);
				ctx.responder.recordToolResult(await describeChange(ctx.editor));
				return {
					caption: move.say ?? describeOp(action.op),
					awaiting: 'continue',
				};
			}

			return {
				caption:
					'I’d need a word or two from you for that — how would you put it?',
				awaiting: 'message',
			};
		},
	};
}
