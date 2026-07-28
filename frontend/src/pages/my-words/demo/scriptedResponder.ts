/**
 * A `Responder` that plays a canned list of moves with a realistic "thinking"
 * pause before each, so a scenario replays deterministically through the real
 * strategy + UI — no model, no network. The script is authored to match a
 * strategy's call pattern (one entry per `next()`).
 */

import type { AssistantMove, Responder } from '../interaction/types';

export function createScriptedResponder(
	script: AssistantMove[],
	opts?: { thinkMs?: number },
): Responder {
	const thinkMs = opts?.thinkMs ?? 850;
	let i = 0;
	return {
		pushWriter() {},
		recordToolResult() {},
		async next(): Promise<AssistantMove> {
			const move = script[i] ?? { say: '…' };
			i += 1;
			await new Promise((r) => setTimeout(r, thinkMs));
			return move;
		},
	};
}
