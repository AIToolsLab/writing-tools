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
 * Payload keys that carry content above the `usage` tier, mapped to the minimum
 * level required to log them. Anything NOT listed is treated as usage-level
 * metadata (event name, generation_type, error codes, counts, client_timestamp).
 *
 * Keys here match what the pages send (see frontend src/api/logging.ts):
 *   - `prompt` / `docContext`     → DocContext (raw document text)   → `document`
 *   - `message` / `target`        → user text / a quoted doc snippet → `document`
 *   - `result` / `generation`     → the AI output we displayed       → `ai_output`
 *   - `response`                  → AI visualization text (Revise)   → `ai_output`
 */
const KEY_MIN_LEVEL: Record<string, ConsentLevel> = {
	prompt: 'document',
	docContext: 'document',
	message: 'document',
	target: 'document',
	result: 'ai_output',
	generation: 'ai_output',
	response: 'ai_output',
};

export interface ConsentFilterResult {
	/** false => drop the whole event (level `none`). */
	allowed: boolean;
	/** The payload with above-level keys removed. */
	extraData: Record<string, unknown>;
	/** Keys removed because they exceeded the user's level (for diagnostics). */
	strippedKeys: string[];
}

/**
 * Apply a consent level to a log payload's `extra_data`. At `none` the whole
 * event is dropped; otherwise content keys above the user's level are stripped.
 */
export function filterExtraDataForConsent(
	extraData: Record<string, unknown>,
	level: ConsentLevel,
): ConsentFilterResult {
	if (level === 'none') {
		return { allowed: false, extraData: {}, strippedKeys: Object.keys(extraData) };
	}

	const rank = consentRank(level);
	const kept: Record<string, unknown> = {};
	const strippedKeys: string[] = [];
	for (const [key, value] of Object.entries(extraData)) {
		const min = KEY_MIN_LEVEL[key];
		if (min && consentRank(min) > rank) {
			strippedKeys.push(key);
			continue;
		}
		kept[key] = value;
	}
	return { allowed: true, extraData: kept, strippedKeys };
}
