/**
 * Types for the proactive-thought-partners probe.
 *
 * Reproduction of Zhang et al., *Designing Proactive Thought Partners for
 * Writing* (arXiv:2609.01588v1) §4. See
 * `docs/proactive-partners-reproduction.md` for the mapping and for the
 * challenge log — several names here are deliberately the paper's rather than
 * this codebase's, so the two can be read side by side.
 */

/**
 * The observable moments a partner may be considered at. The paper's three
 * (§4.2), kept in its order and with its default timings.
 */
export type EventTrigger = 'long-pause' | 'sentence-end' | 'text-selection';

export const EVENT_TRIGGERS: EventTrigger[] = [
	'long-pause',
	'sentence-end',
	'text-selection',
];

export const TRIGGER_LABELS: Record<EventTrigger, string> = {
	'long-pause': 'Long pause',
	'sentence-end': 'Sentence end',
	'text-selection': 'Text selection',
};

/** The rationale each trigger came from, shown in the config panel. */
export const TRIGGER_HINTS: Record<EventTrigger, string> = {
	'long-pause': 'After you stop for a while — a natural break.',
	'sentence-end': 'Just after you finish a sentence.',
	'text-selection': 'When you select text and sit with it.',
};

/**
 * A writer-configured partner. The four fields are the paper's (§4.1): what
 * kind of help, when it may consider helping, and under what conditions it
 * should actually speak.
 */
export interface Partner {
	id: string;
	/** Shown on the floating tag beside the name. */
	emoji: string;
	name: string;
	/** What kind of support this partner provides. */
	role: string;
	/** Broad candidate moments. Empty means the partner never activates. */
	triggers: EventTrigger[];
	/**
	 * The contextual criteria under which the partner should take the
	 * initiative once one of its triggers fires — "when a claim lacks
	 * evidence", "when the argument may need a counterpoint".
	 */
	heuristic: string;
	enabled: boolean;
}

/**
 * One tick of coarse writing behaviour, standing in for the paper's keystroke
 * log (challenge C1). Derived by diffing polled document snapshots, so a
 * single record can cover several seconds of typing rather than one key.
 */
export interface ActivityRecord {
	/** ms since epoch. */
	at: number;
	kind: 'typed' | 'deleted' | 'revised' | 'moved' | 'selected' | 'idle';
	/** Net characters added (negative for deletions). */
	charsDelta: number;
	/** Cursor offset from the start of the document, after the change. */
	cursor: number;
}

/** A snapshot of the document as the polling loop sees it. */
export interface DocSnapshot {
	at: number;
	beforeCursor: string;
	selectedText: string;
	afterCursor: string;
}

/** A fired trigger, with the context the decision engine will need. */
export interface TriggerEvent {
	trigger: EventTrigger;
	at: number;
	snapshot: DocSnapshot;
	/** The rolling activity window, oldest first. */
	activity: ActivityRecord[];
}

/** What the decision engine returns for one activated partner. */
export interface Activation {
	/** Unique per activation, so a re-activated partner gets a fresh card. */
	id: string;
	partnerId: string;
	trigger: EventTrigger;
	at: number;
	/** The engine's own one-line reason. Shown only in the log, not the UI. */
	why: string;
	/** The document state that activated it, reused for suggestion generation. */
	snapshot: DocSnapshot;
	activity: ActivityRecord[];
}

/** The two-part suggestion of §4.3. */
export interface Suggestion {
	acknowledgement: string;
	question: string;
}
