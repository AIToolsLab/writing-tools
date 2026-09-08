import { describe, expect, it } from 'vitest';
import {
	activeTriggers,
	emptyPartner,
	isPartnerActivatable,
	parsePartners,
	partnersForTrigger,
	serializePartners,
} from '../storage';
import type { Partner } from '../types';

function partner(overrides: Partial<Partner> = {}): Partner {
	return {
		id: 'p1',
		emoji: '🔎',
		name: 'Evidence',
		role: 'Help me strengthen claims with concrete support.',
		triggers: ['long-pause'],
		heuristic: 'When I make a claim without an example.',
		enabled: true,
		...overrides,
	};
}

describe('emptyPartner', () => {
	it("selects no triggers, matching the paper's anti-anchoring default", () => {
		expect(emptyPartner().triggers).toEqual([]);
	});
});

describe('parsePartners', () => {
	it('round-trips', () => {
		const partners = [partner(), partner({ id: 'p2', name: 'Skeptic' })];
		expect(parsePartners(serializePartners(partners))).toEqual(partners);
	});

	it('returns nothing for absent or unreadable values', () => {
		expect(parsePartners(null)).toEqual([]);
		expect(parsePartners('')).toEqual([]);
		expect(parsePartners('not json')).toEqual([]);
		expect(parsePartners('{"partners":[]}')).toEqual([]);
	});

	it('drops entries with no id rather than failing the whole list', () => {
		const raw = JSON.stringify([{ name: 'nameless' }, partner()]);
		expect(parsePartners(raw).map((p) => p.id)).toEqual(['p1']);
	});

	it('drops unknown trigger names', () => {
		const raw = JSON.stringify([
			{ ...partner(), triggers: ['long-pause', 'telepathy'] },
		]);
		expect(parsePartners(raw)[0].triggers).toEqual(['long-pause']);
	});

	it('defaults enabled to true and emoji to a placeholder', () => {
		const raw = JSON.stringify([{ id: 'p9' }]);
		expect(parsePartners(raw)[0]).toMatchObject({
			enabled: true,
			emoji: '💭',
		});
	});
});

describe('isPartnerActivatable', () => {
	it('requires a name, a role, a heuristic and a trigger', () => {
		expect(isPartnerActivatable(partner())).toBe(true);
		expect(isPartnerActivatable(partner({ name: ' ' }))).toBe(false);
		expect(isPartnerActivatable(partner({ role: '' }))).toBe(false);
		expect(isPartnerActivatable(partner({ heuristic: '' }))).toBe(false);
		expect(isPartnerActivatable(partner({ triggers: [] }))).toBe(false);
		expect(isPartnerActivatable(partner({ enabled: false }))).toBe(false);
	});
});

describe('partnersForTrigger / activeTriggers', () => {
	const partners = [
		partner({ id: 'a', triggers: ['long-pause'] }),
		partner({ id: 'b', triggers: ['text-selection', 'sentence-end'] }),
		partner({ id: 'c', triggers: ['long-pause'], enabled: false }),
		partner({ id: 'd', triggers: ['long-pause'], heuristic: '' }),
	];

	it('matches only complete, enabled partners listening for the trigger', () => {
		expect(
			partnersForTrigger(partners, 'long-pause').map((p) => p.id),
		).toEqual(['a']);
		expect(
			partnersForTrigger(partners, 'sentence-end').map((p) => p.id),
		).toEqual(['b']);
	});

	it('reports which triggers are worth watching for at all', () => {
		expect([...activeTriggers(partners)].sort()).toEqual([
			'long-pause',
			'sentence-end',
			'text-selection',
		]);
		expect(activeTriggers([partner({ triggers: [] })]).size).toBe(0);
	});
});
