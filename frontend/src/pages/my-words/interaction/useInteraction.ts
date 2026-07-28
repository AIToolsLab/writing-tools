/**
 * React glue around an `InteractionStrategy`: owns the turn-facing state
 * (caption, what the writer can do next, any staged proposal, thinking) and
 * exposes a single stable `submit(input)` that runs one turn and resolves when
 * the floor passes back. Both the live page and the demo harness drive turns
 * through this, so they share identical behavior.
 */

import { useCallback, useRef, useState } from 'react';

import type { Corpus } from '../corpus';
import type {
	Awaiting,
	InteractionStrategy,
	PendingProposal,
	Responder,
	StrategyContext,
	TurnInput,
} from './types';

export interface UseInteractionOptions {
	editor: EditorAPI;
	strategy: InteractionStrategy;
	responder: Responder;
	corpus: () => Promise<Corpus>;
	initialCaption?: string;
}

export interface UseInteractionResult {
	caption: string;
	awaiting: Awaiting;
	pending: PendingProposal | null;
	isThinking: boolean;
	submit: (input: TurnInput) => Promise<void>;
}

export function useInteraction(
	opts: UseInteractionOptions,
): UseInteractionResult {
	const [caption, setCaption] = useState(
		opts.initialCaption ??
			'Tell me what you’re trying to say, and we’ll shape it in your own words.',
	);
	const [awaiting, setAwaiting] = useState<Awaiting>('message');
	const [pending, setPending] = useState<PendingProposal | null>(null);
	const [isThinking, setIsThinking] = useState(false);

	// Keep latest opts without destabilizing `submit` (the demo autoplay relies
	// on a stable reference to chain `await`ed turns).
	const optsRef = useRef(opts);
	optsRef.current = opts;
	const busy = useRef(false);

	const submit = useCallback(async (input: TurnInput) => {
		if (busy.current) return;
		busy.current = true;
		setIsThinking(true);
		const { editor, strategy, responder, corpus } = optsRef.current;
		const ctx: StrategyContext = {
			editor,
			responder,
			corpus,
			setCaption,
		};
		try {
			const res = await strategy.run(input, ctx);
			setCaption(res.caption);
			setAwaiting(res.awaiting);
			setPending(res.pending ?? null);
		} catch (e) {
			setCaption(`⚠️ ${(e as Error).message}`);
			setAwaiting('message');
			setPending(null);
		} finally {
			setIsThinking(false);
			busy.current = false;
		}
	}, []);

	return { caption, awaiting, pending, isThinking, submit };
}
