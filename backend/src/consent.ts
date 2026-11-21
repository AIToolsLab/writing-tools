/**
 * Logging-consent levels and the server-side content gate.
 *
 * The add-in is a product first, with a longitudinal-study opt-in on top. Each
 * user carries a `loggingConsent` level (stored on the Better Auth user record).
 * Levels are cumulative — a higher level logs everything a lower one does plus
 * more. This module is the single source of truth for that ordering and for
 * which payload fields are allowed at which level. The client pre-strips to the
 * same rules, but the server re-applies them so a tampered client can't escalate.
 *
 * These levels govern *study/analytics* logging only. LLM usage metering (usage.ts)
 * sits outside them deliberately: it's the content-free billing record for requests
 * we are charged for, so it is kept at every level, including `none`.
 */

export const CONSENT_LEVELS = [
	'none', // no analytics, no event logs (crash reports handled separately, client-side)
	'usage', // feature events: which buttons/modes, counts, timings — NO content
	'ai_output', // also the sidebar suggestions / generations we showed
	'document', // also the document text (DocContext: before/selected/after cursor)
] as const;

export type ConsentLevel = (typeof CONSENT_LEVELS)[number];

export const DEFAULT_CONSENT_LEVEL: ConsentLevel = 'usage';

// The highest level — logs everything. Anonymous/demo users are created here: the
// public demo discloses that all usage is logged, so there's nothing to opt up to.
// Computed from the tail of CONSENT_LEVELS so it tracks the ordering if it changes.
export const FULL_CONSENT_LEVEL: ConsentLevel = CONSENT_LEVELS[
	CONSENT_LEVELS.length - 1
] as ConsentLevel; // CONSENT_LEVELS is a non-empty const tuple

export function isConsentLevel(value: unknown): value is ConsentLevel {
	return (
		typeof value === 'string' &&
		(CONSENT_LEVELS as readonly string[]).includes(value)
	);
}

export function consentRank(level: ConsentLevel): number {
	return CONSENT_LEVELS.indexOf(level);
}

/**
 * A log event's payload is split into buckets named after the lowest consent
 * level allowed to store them. The writer of each event declares, field by
 * field, which bucket it belongs in (frontend `src/api/logging.ts`), so a
 * consent decision is made where the data is logged instead of depending on
 * a list of content-bearing key names that someone has to remember to update.
 *
 *   - `usage`     — counts, timings, modes, ids. Values must be primitives or
 *                   arrays of primitives; anything nested is dropped, because a
 *                   nested object is where a DocContext would hide.
 *   - `ai_output` — what the assistant showed the writer. May quote the
 *                   writer's text (doctext citations), which the consent copy
 *                   for that level says.
 *   - `document`  — anything the writer wrote: document text, chat messages,
 *                   the brief, quoted spans, proposed edits.
 *
 * The gate is default-closed: a top-level key that is not part of the envelope
 * and not a bucket is dropped at every level, and its name is reported back so
 * a missing metric is visible rather than silent. A dropped field is a lost
 * metric; an unclassified field that ships is a broken promise.
 */
export const LOG_BUCKETS = ['usage', 'ai_output', 'document'] as const;

export type LogBucket = (typeof LOG_BUCKETS)[number];

export type LogBuckets = Partial<Record<LogBucket, Record<string, unknown>>>;

function isLogBucket(key: string): key is LogBucket {
	return (LOG_BUCKETS as readonly string[]).includes(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUsageValue(value: unknown): boolean {
	const primitive = (v: unknown) =>
		v === null || ['string', 'number', 'boolean'].includes(typeof v);
	return primitive(value) || (Array.isArray(value) && value.every(primitive));
}

export interface ConsentFilterResult {
	/** false => drop the whole event (level `none`). */
	allowed: boolean;
	/** The buckets the user's level permits, with usage values checked. */
	buckets: LogBuckets;
	/**
	 * Fields dropped because nobody classified them (an unknown top-level key,
	 * a bucket that isn't an object, a nested value in `usage`) — as
	 * `key` or `bucket.key`. Not the buckets stripped for being above the
	 * user's level: that is consent working, not a mistake.
	 */
	unclassified: string[];
}

/**
 * Apply a consent level to a log payload (the envelope fields already
 * removed). At `none` the event is dropped; otherwise buckets above the level
 * are removed and anything outside a bucket is dropped.
 */
export function filterLogPayloadForConsent(
	payload: Record<string, unknown>,
	level: ConsentLevel,
): ConsentFilterResult {
	if (level === 'none') {
		return { allowed: false, buckets: {}, unclassified: [] };
	}

	const rank = consentRank(level);
	const buckets: LogBuckets = {};
	const unclassified: string[] = [];
	for (const [key, value] of Object.entries(payload)) {
		if (!isLogBucket(key) || !isPlainObject(value)) {
			unclassified.push(key);
			continue;
		}
		if (consentRank(key) > rank) continue;
		if (key !== 'usage') {
			buckets[key] = value;
			continue;
		}
		const usage: Record<string, unknown> = {};
		for (const [field, fieldValue] of Object.entries(value)) {
			if (isUsageValue(fieldValue)) usage[field] = fieldValue;
			else unclassified.push(`usage.${field}`);
		}
		buckets.usage = usage;
	}
	return { allowed: true, buckets, unclassified };
}
