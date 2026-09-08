/**
 * The watching loop: poll the document, detect triggers, ask the decision
 * engine, and hold the resulting activations until they are opened or fade.
 *
 * This is the part of the reproduction that a task pane makes awkward. The
 * paper listens to keystrokes and pays nothing per event; we poll the host and
 * pay a round-trip per tick (challenges C1 and C2 in
 * `docs/proactive-partners-reproduction.md`). Consequences visible here:
 *
 * - The loop does not run at all unless at least one partner is complete and
 *   enabled, and it stops while the pane is off screen.
 * - Trigger latency is quantised to {@link POLL_MS}.
 * - A decision call in flight suppresses new triggers, so a slow model cannot
 *   queue up a backlog of interruptions to deliver at once.
 */
import {
	useCallback,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from 'react';
import { decideActivations } from './engine';
import {
	DEFAULT_SIGNAL_CONFIG,
	initialSignalState,
	observe,
	type SignalConfig,
	type SignalState,
} from './signals';
import { activeTriggers, partnersForTrigger } from './storage';
import type { Activation, DocSnapshot, Partner, TriggerEvent } from './types';

/**
 * How often to read the document.
 *
 * A compromise, and the place to look first if the triggers feel wrong. Faster
 * sharpens the paper's 1-second sentence-end trigger but multiplies host
 * round-trips — on Google Docs each one is an Apps Script call that re-fetches
 * the whole document.
 */
export const POLL_MS = 1_500;

/** The paper's fade: an ignored tag "gradually fades out and disappears after 15 seconds" (§4.4). */
export const TAG_TTL_MS = 15_000;

export interface PartnerWatchOptions {
	editorAPI: EditorAPI;
	partners: Partner[];
	/** Prompt-formatted document brief, standing in for the paper's session goal. */
	brief: string | null;
	/** Whether the writer has the watch switched on. */
	watching: boolean;
	config?: SignalConfig;
	onTrigger?: (event: TriggerEvent, candidates: number) => void;
	onActivate?: (activations: Activation[], event: TriggerEvent) => void;
	onDecisionError?: (error: unknown) => void;
}

export interface PartnerWatchResult {
	/** Live activations, newest last. Expired ones are removed here, not by the UI. */
	activations: Activation[];
	/** True while a decision call is in flight. */
	deciding: boolean;
	/** Remove one activation — because it was opened, or dismissed. */
	remove: (activationId: string) => void;
	/** Keep an activation past its fade (the writer opened it). */
	pin: (activationId: string) => void;
}

function activationId(): string {
	return `a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function usePartnerWatch({
	editorAPI,
	partners,
	brief,
	watching,
	config = DEFAULT_SIGNAL_CONFIG,
	onTrigger,
	onActivate,
	onDecisionError,
}: PartnerWatchOptions): PartnerWatchResult {
	const [activations, setActivations] = useState<Activation[]>([]);
	const [deciding, setDeciding] = useState(false);

	const signalRef = useRef<SignalState>(initialSignalState());
	const inFlightRef = useRef<AbortController | null>(null);
	/** Activations the writer opened; these no longer fade. */
	const pinnedRef = useRef<Set<string>>(new Set());

	const remove = useCallback((id: string) => {
		pinnedRef.current.delete(id);
		setActivations((current) => current.filter((a) => a.id !== id));
	}, []);

	const pin = useCallback((id: string) => {
		pinnedRef.current.add(id);
	}, []);

	// The whole trigger→decision step, kept as an effect event so the polling
	// effect depends only on what should actually restart it (whether we are
	// watching, and which triggers are worth watching for).
	const tick = useEffectEvent(async () => {
		// Drop tags the writer ignored past the fade.
		const now = Date.now();
		setActivations((current) =>
			current.filter(
				(a) => pinnedRef.current.has(a.id) || now - a.at < TAG_TTL_MS,
			),
		);

		let context: DocContext;
		try {
			context = await editorAPI.getDocContext();
		} catch (error) {
			// A failed read is a missed tick, not a failed feature: the host is
			// busy, or the document is mid-save. Try again next interval.
			console.warn('partners: could not read the document', error);
			return;
		}

		const snapshot: DocSnapshot = {
			at: Date.now(),
			beforeCursor: context.beforeCursor,
			selectedText: context.selectedText,
			afterCursor: context.afterCursor,
		};

		// Only the triggers some partner listens for are evaluated: an
		// unwatched trigger that fired would start the cooldown and suppress
		// the one the writer actually configured.
		const result = observe(
			signalRef.current,
			snapshot,
			config,
			activeTriggers(partners),
		);
		signalRef.current = result.state;
		if (!result.event) return;

		// A decision already in flight means the previous trigger has not been
		// answered yet. Dropping this one is deliberate: the alternative is
		// several partners arriving at once, moments apart.
		if (inFlightRef.current) return;

		const candidates = partnersForTrigger(partners, result.event.trigger);
		onTrigger?.(result.event, candidates.length);
		if (candidates.length === 0) return;

		const controller = new AbortController();
		inFlightRef.current = controller;
		setDeciding(true);
		try {
			const choices = await decideActivations(
				result.event,
				candidates,
				brief,
				controller.signal,
			);
			const chosen: Activation[] = choices.flatMap((choice) => {
				const partner = candidates.find((p) => p.id === choice.id);
				if (!partner) return [];
				return [
					{
						id: activationId(),
						partnerId: partner.id,
						trigger: result.event!.trigger,
						at: Date.now(),
						why: choice.why,
						snapshot: result.event!.snapshot,
						activity: result.event!.activity,
					},
				];
			});
			if (chosen.length > 0) {
				setActivations((current) => [...current, ...chosen]);
			}
			onActivate?.(chosen, result.event);
		} catch (error) {
			if (!controller.signal.aborted) onDecisionError?.(error);
		} finally {
			if (inFlightRef.current === controller) inFlightRef.current = null;
			setDeciding(false);
		}
	});

	// Which triggers any partner listens for. Serialized so the effect restarts
	// when the *set* changes, not on every render of an equal set.
	const watchedTriggers = [...activeTriggers(partners)].sort().join(',');
	const shouldWatch = watching && watchedTriggers !== '';

	useEffect(() => {
		if (!shouldWatch) {
			// Start clean next time: a state built from before the pause would
			// read a long gap as a pause the writer never took.
			signalRef.current = initialSignalState();
			return;
		}

		let stopped = false;
		function schedule(): void {
			if (stopped) return;
			if (document.visibilityState !== 'visible') return;
			void tick();
		}
		// Take the baseline immediately, not on the first interval.
		//
		// A polled observer has no history from before it started, so its very
		// first snapshot is indistinguishable from "text the writer just
		// typed": whatever is in the document becomes the baseline. Anything
		// written in the gap before that baseline is therefore invisible, and
		// a writer who switches watching on and immediately types a sentence
		// and stops would get no pause at all — the burst would have been
		// absorbed into the baseline. Sampling at once shrinks that blind
		// window from a full POLL_MS to however long one host read takes. It
		// cannot close it; see challenge C9.
		schedule();
		const timer = setInterval(schedule, POLL_MS);
		return () => {
			stopped = true;
			clearInterval(timer);
			inFlightRef.current?.abort();
			inFlightRef.current = null;
		};
	}, [shouldWatch, watchedTriggers]);

	// Fading has to happen on a clock of its own: with no editing activity
	// there may be no tick to expire a tag that the writer is ignoring.
	useEffect(() => {
		if (activations.length === 0) return;
		const timer = setInterval(() => {
			const now = Date.now();
			setActivations((current) =>
				current.filter(
					(a) =>
						pinnedRef.current.has(a.id) || now - a.at < TAG_TTL_MS,
				),
			);
		}, 1_000);
		return () => clearInterval(timer);
	}, [activations.length]);

	return { activations, deciding, remove, pin };
}
