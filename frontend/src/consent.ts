/**
 * Logging-consent levels — the client mirror of backend/src/consent.ts.
 *
 * The add-in is a product first, with a longitudinal-study opt-in on top. Each
 * user carries a `loggingConsent` level (stored on their Better Auth record and
 * delivered via /api/protected). Levels are cumulative. The client strips content
 * to the user's level before sending events so we don't transmit more than the
 * user allowed; the server re-applies the same rules authoritatively.
 */

export const CONSENT_LEVELS = [
	'none', // no analytics, no event logs (crash reports handled separately)
	'usage', // feature events: buttons/modes, counts, timings — NO content
	'ai_output', // also the sidebar suggestions / generations we showed
	'document', // also the document text (DocContext)
] as const;

export type ConsentLevel = (typeof CONSENT_LEVELS)[number];

export const DEFAULT_CONSENT_LEVEL: ConsentLevel = 'usage';

export function isConsentLevel(value: unknown): value is ConsentLevel {
	return (
		typeof value === 'string' &&
		(CONSENT_LEVELS as readonly string[]).includes(value)
	);
}

export function consentRank(level: ConsentLevel): number {
	return CONSENT_LEVELS.indexOf(level);
}

/** Human-readable summary of what each level collects, for the consent UI. */
export const CONSENT_LEVEL_LABELS: Record<
	ConsentLevel,
	{ title: string; description: string }
> = {
	none: {
		title: 'No logging',
		description:
			'No usage analytics or event logging at all — nothing about your activity is sent to our servers.',
	},
	usage: {
		title: 'Usage only',
		description:
			'Which features you use (buttons, modes, counts, timing). No document text and no AI suggestions are stored.',
	},
	ai_output: {
		title: 'Usage + AI suggestions',
		description:
			'Also stores the suggestions the assistant shows you. Your document text itself is still not stored.',
	},
	document: {
		title: 'Full study logging',
		description:
			'Also stores the document context sent for suggestions. Choose this only as part of a study you have agreed to join.',
	},
};

// Payload keys carrying content above the `usage` tier (must match backend
// KEY_MIN_LEVEL). `prompt`/`docContext` are document text; `result`/`generation`
// are AI output. Anything else is usage-level metadata.
const KEY_MIN_LEVEL: Record<string, ConsentLevel> = {
	prompt: 'document',
	docContext: 'document',
	result: 'ai_output',
	generation: 'ai_output',
};

export interface ConsentFilterResult {
	/** false => don't send the event at all (level `none`). */
	allowed: boolean;
	payload: Record<string, unknown>;
}

/**
 * Strip a log payload to what the given consent level permits. At `none` the
 * event is dropped; otherwise content keys above the level are removed.
 */
export function filterPayloadForConsent(
	payload: Record<string, unknown>,
	level: ConsentLevel,
): ConsentFilterResult {
	if (level === 'none') {
		return { allowed: false, payload: {} };
	}
	const rank = consentRank(level);
	const kept: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(payload)) {
		const min = KEY_MIN_LEVEL[key];
		if (min && consentRank(min) > rank) continue;
		kept[key] = value;
	}
	return { allowed: true, payload: kept };
}
