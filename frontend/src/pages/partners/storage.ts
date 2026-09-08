/**
 * Persistence for writer-configured partners.
 *
 * Partners live *with the document* (`EditorAPI.getDocumentSetting` /
 * `setDocumentSetting`), alongside the writer's brief. The paper's partners
 * are per-user and reused across sessions; document settings are the only
 * store that works on all three of our surfaces, so this is a deviation —
 * see challenge C6 in `docs/proactive-partners-reproduction.md`.
 *
 * Parsing is defensive rather than schema-validated: the value is JSON written
 * by an older build of this same page, and a partner list that fails to load
 * would silently disable the whole feature. Anything unreadable is dropped,
 * anything readable is kept.
 */
import { EVENT_TRIGGERS, type EventTrigger, type Partner } from './types';

/** The document setting the partner list is serialized into, as JSON. */
export const PARTNERS_SETTING_KEY = 'proactivePartners';

export function newPartnerId(): string {
	return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * A blank partner. Deliberately starts with **no triggers selected** — the
 * paper does the same "to avoid anchoring effects" (§4.1, Fig. 3), and a
 * partner with no trigger simply never activates, which is the honest default
 * for something the writer has not finished configuring.
 */
export function emptyPartner(): Partner {
	return {
		id: newPartnerId(),
		emoji: '💭',
		name: '',
		role: '',
		triggers: [],
		heuristic: '',
		enabled: true,
	};
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

function asTriggers(value: unknown): EventTrigger[] {
	if (!Array.isArray(value)) return [];
	return EVENT_TRIGGERS.filter((trigger) => value.includes(trigger));
}

export function parsePartners(raw: string | null): Partner[] {
	if (!raw) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (!Array.isArray(parsed)) return [];
	return parsed.flatMap((entry): Partner[] => {
		if (typeof entry !== 'object' || entry === null) return [];
		const record = entry as Record<string, unknown>;
		const id = asString(record.id);
		if (!id) return [];
		return [
			{
				id,
				emoji: asString(record.emoji, '💭') || '💭',
				name: asString(record.name),
				role: asString(record.role),
				triggers: asTriggers(record.triggers),
				heuristic: asString(record.heuristic),
				enabled: record.enabled !== false,
			},
		];
	});
}

export function serializePartners(partners: Partner[]): string {
	return JSON.stringify(partners);
}

/**
 * Whether a partner is complete enough to activate. A partner with no role has
 * nothing to say, one with no heuristic gives the decision engine no criterion
 * to test, and one with no trigger has no moment to be considered at.
 */
export function isPartnerActivatable(partner: Partner): boolean {
	return (
		partner.enabled &&
		partner.name.trim() !== '' &&
		partner.role.trim() !== '' &&
		partner.heuristic.trim() !== '' &&
		partner.triggers.length > 0
	);
}

/** The partners eligible to be considered when `trigger` fires. */
export function partnersForTrigger(
	partners: Partner[],
	trigger: EventTrigger,
): Partner[] {
	return partners.filter(
		(partner) =>
			isPartnerActivatable(partner) && partner.triggers.includes(trigger),
	);
}

/** The union of triggers any activatable partner listens for. */
export function activeTriggers(partners: Partner[]): Set<EventTrigger> {
	const active = new Set<EventTrigger>();
	for (const partner of partners) {
		if (!isPartnerActivatable(partner)) continue;
		for (const trigger of partner.triggers) active.add(trigger);
	}
	return active;
}
