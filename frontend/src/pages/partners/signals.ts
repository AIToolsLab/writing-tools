/**
 * Trigger detection for the proactive-partners probe.
 *
 * The paper's three event triggers (§4.2) are rule-based over a live keystroke
 * stream. A task pane has no such stream — the writer types into Word or
 * Google Docs, and the only channel back is `EditorAPI.getDocContext()`. So
 * this module reconstructs the triggers by *diffing polled snapshots of the
 * document*, and reconstructs the paper's 15-second keystroke log as a much
 * coarser activity trace over the same diffs. See challenge C1 in
 * `docs/proactive-partners-reproduction.md` for what that loses.
 *
 * Everything here is a pure function of (state, snapshot, config) so the whole
 * state machine is testable by feeding it snapshots with made-up timestamps —
 * no timers, no fake clocks, no host.
 */
import type {
	ActivityRecord,
	DocSnapshot,
	EventTrigger,
	TriggerEvent,
} from './types';

export interface SignalConfig {
	/** Idle time before a pause counts as one. Paper's default: 5s. */
	pauseMs: number;
	/** Idle time after a completed sentence. Paper's default: 1s. */
	sentenceIdleMs: number;
	/** Idle time with a selection held. Paper's default: 5s. */
	selectionIdleMs: number;
	/**
	 * Minimum gap between two fired triggers. **Not in the paper** — it exists
	 * because polling makes triggers noisier than keystrokes do (challenge C8),
	 * and because each fired trigger costs a model call.
	 */
	cooldownMs: number;
	/** How much activity history to keep. Paper's window: 15s. */
	activityWindowMs: number;
}

export const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
	pauseMs: 5_000,
	sentenceIdleMs: 1_000,
	selectionIdleMs: 5_000,
	cooldownMs: 45_000,
	activityWindowMs: 15_000,
};

export interface SignalState {
	last: DocSnapshot | null;
	/** Rolling activity window, oldest first. */
	activity: ActivityRecord[];
	/** When the document last changed in any way (text, cursor, or selection). */
	lastChangeAt: number;
	/** When the document *text* last changed. 0 if it never has. */
	lastTextChangeAt: number;
	/** True once a pause has fired for the current quiet period. */
	pauseFired: boolean;
	/** Fingerprint of the sentence a sentence-end already fired for. */
	sentenceEndFiredFor: string | null;
	/** The selected text a selection trigger already fired for. */
	selectionFiredFor: string | null;
	/** When the current selection last changed. */
	selectionSince: number;
	/** When a trigger last fired, for the cooldown. */
	lastEventAt: number;
}

export function initialSignalState(): SignalState {
	return {
		last: null,
		activity: [],
		lastChangeAt: 0,
		lastTextChangeAt: 0,
		pauseFired: false,
		sentenceEndFiredFor: null,
		selectionFiredFor: null,
		selectionSince: 0,
		lastEventAt: 0,
	};
}

export function snapshotText(snapshot: DocSnapshot): string {
	return snapshot.beforeCursor + snapshot.selectedText + snapshot.afterCursor;
}

/** Character offset of the cursor (or of the selection start). */
export function cursorOffset(snapshot: DocSnapshot): number {
	return snapshot.beforeCursor.length;
}

/**
 * Sentence-final punctuation, allowing trailing closing quotes/brackets and
 * whitespace: `... end."` and `... end.)` both count.
 *
 * Known false positive: abbreviations ("e.g.", "Dr.") read as sentence ends.
 * The paper does not say how it handled this, and over-firing is cheap here —
 * a sentence-end trigger only makes the decision engine *consider* partners,
 * which can and often does decline.
 */
const SENTENCE_END = /[.!?]["'”’)\]]*\s*$/;

export function endsSentence(beforeCursor: string): boolean {
	return SENTENCE_END.test(beforeCursor);
}

/** Stable-enough identity for "the sentence the cursor just finished". */
function sentenceFingerprint(beforeCursor: string): string {
	return `${beforeCursor.length}:${beforeCursor.slice(-80)}`;
}

function classify(
	prev: DocSnapshot,
	next: DocSnapshot,
): ActivityRecord['kind'] {
	const prevText = snapshotText(prev);
	const nextText = snapshotText(next);
	if (prevText !== nextText) {
		const delta = nextText.length - prevText.length;
		if (delta > 0) return 'typed';
		if (delta < 0) return 'deleted';
		// Same length, different content: a replacement or an overtype.
		return 'revised';
	}
	if (prev.selectedText !== next.selectedText) return 'selected';
	if (cursorOffset(prev) !== cursorOffset(next)) return 'moved';
	return 'idle';
}

/** Every trigger, for callers that do not narrow. */
const ALL_TRIGGERS: ReadonlySet<EventTrigger> = new Set<EventTrigger>([
	'long-pause',
	'sentence-end',
	'text-selection',
]);

/**
 * Fold one polled snapshot into the state, returning the new state and any
 * trigger that fired.
 *
 * At most one trigger fires per observation. When several are due the most
 * specific wins (selection, then sentence end, then pause) — the paper does
 * not specify an order because with keystrokes its triggers rarely coincide;
 * with polling they routinely do.
 *
 * `watched` is the set of triggers some partner is actually listening for.
 * Triggers outside it are not evaluated at all, rather than fired and then
 * discarded by the caller — a fired trigger starts the cooldown, so an
 * unwatched one would spend the quiet period that a watched one needed. That
 * is not hypothetical: a partner listening only for pauses got nothing at all,
 * because every sentence the writer finished fired an unwatched sentence-end
 * first and suppressed the pause behind it.
 */
export function observe(
	state: SignalState,
	snapshot: DocSnapshot,
	config: SignalConfig = DEFAULT_SIGNAL_CONFIG,
	watched: ReadonlySet<EventTrigger> = ALL_TRIGGERS,
): { state: SignalState; event: TriggerEvent | null } {
	const now = snapshot.at;

	// First observation establishes the baseline; nothing to diff against.
	if (state.last === null) {
		return {
			state: {
				...state,
				last: snapshot,
				lastChangeAt: now,
				selectionSince: now,
			},
			event: null,
		};
	}

	const kind = classify(state.last, snapshot);
	const textChanged =
		kind === 'typed' || kind === 'deleted' || kind === 'revised';
	const selectionChanged = state.last.selectedText !== snapshot.selectedText;

	const next: SignalState = { ...state, last: snapshot };

	if (kind !== 'idle') {
		const record: ActivityRecord = {
			at: now,
			kind,
			charsDelta:
				snapshotText(snapshot).length - snapshotText(state.last).length,
			cursor: cursorOffset(snapshot),
		};
		next.activity = [...state.activity, record].filter(
			(entry) => now - entry.at <= config.activityWindowMs,
		);
		next.lastChangeAt = now;
		// Any activity opens a new quiet period.
		next.pauseFired = false;
	} else {
		next.activity = state.activity.filter(
			(entry) => now - entry.at <= config.activityWindowMs,
		);
	}

	if (textChanged) next.lastTextChangeAt = now;
	if (selectionChanged) {
		next.selectionSince = now;
		next.selectionFiredFor = null;
	}

	// A writer who has not typed anything yet is not pausing or finishing a
	// sentence; they have not started. Selection is exempt — selecting text in
	// an existing document is a real signal on its own.
	const hasWritten = next.lastTextChangeAt > 0;
	const idleFor = now - next.lastChangeAt;
	const textIdleFor = now - next.lastTextChangeAt;
	const inCooldown =
		next.lastEventAt > 0 && now - next.lastEventAt < config.cooldownMs;

	const fire = (
		trigger: EventTrigger,
	): { state: SignalState; event: TriggerEvent } => ({
		state: { ...next, lastEventAt: now },
		event: { trigger, at: now, snapshot, activity: next.activity },
	});

	if (inCooldown) return { state: next, event: null };

	// 1. Text selection: a selection held still long enough to mean something.
	if (
		watched.has('text-selection') &&
		snapshot.selectedText.trim() !== '' &&
		now - next.selectionSince >= config.selectionIdleMs &&
		next.selectionFiredFor !== snapshot.selectedText
	) {
		const fired = fire('text-selection');
		fired.state.selectionFiredFor = snapshot.selectedText;
		return fired;
	}

	// 2. Sentence end: the cursor sits just past sentence-final punctuation and
	//    the writer has stopped for the short idle the paper uses.
	const fingerprint = sentenceFingerprint(snapshot.beforeCursor);
	if (
		watched.has('sentence-end') &&
		hasWritten &&
		snapshot.selectedText === '' &&
		endsSentence(snapshot.beforeCursor) &&
		textIdleFor >= config.sentenceIdleMs &&
		next.sentenceEndFiredFor !== fingerprint
	) {
		const fired = fire('sentence-end');
		fired.state.sentenceEndFiredFor = fingerprint;
		return fired;
	}

	// 3. Long pause: nothing at all has happened for a while.
	if (
		watched.has('long-pause') &&
		hasWritten &&
		!next.pauseFired &&
		idleFor >= config.pauseMs
	) {
		const fired = fire('long-pause');
		fired.state.pauseFired = true;
		return fired;
	}

	return { state: next, event: null };
}

/**
 * Render the activity window as the prose the decision engine reads.
 *
 * The paper hands its engine a keystroke log; this is the honest description
 * of what we have instead. Written as a summary rather than a dump because the
 * records are already lossy — pretending to per-key detail would invite the
 * model to over-read them.
 */
export function describeActivity(
	activity: ActivityRecord[],
	now: number,
	windowMs: number = DEFAULT_SIGNAL_CONFIG.activityWindowMs,
): string {
	const seconds = Math.round(windowMs / 1000);
	if (activity.length === 0) {
		return `No editing activity in the last ${seconds} seconds.`;
	}
	const added = activity
		.filter((entry) => entry.charsDelta > 0)
		.reduce((sum, entry) => sum + entry.charsDelta, 0);
	const removed = -activity
		.filter((entry) => entry.charsDelta < 0)
		.reduce((sum, entry) => sum + entry.charsDelta, 0);
	const kinds = new Set(activity.map((entry) => entry.kind));
	const last = activity[activity.length - 1];
	const sinceLast = Math.round((now - last.at) / 1000);

	const parts = [
		`In the last ${seconds} seconds: about ${added} characters added` +
			(removed > 0 ? `, ${removed} deleted` : '') +
			'.',
		`Observed activity: ${[...kinds].join(', ')}.`,
		`Last observed change was about ${sinceLast} second${sinceLast === 1 ? '' : 's'} ago.`,
	];
	return parts.join(' ');
}
