import { describe, expect, it } from 'vitest';
import {
	type ConsentLevel,
	consentRank,
	filterExtraDataForConsent,
	isConsentLevel,
} from '../consent.js';

describe('isConsentLevel / consentRank', () => {
	it('recognizes valid levels and orders them cumulatively', () => {
		expect(isConsentLevel('usage')).toBe(true);
		expect(isConsentLevel('nope')).toBe(false);
		expect(isConsentLevel(3)).toBe(false);
		expect(consentRank('none')).toBeLessThan(consentRank('usage'));
		expect(consentRank('usage')).toBeLessThan(consentRank('ai_output'));
		expect(consentRank('ai_output')).toBeLessThan(consentRank('document'));
	});
});

describe('filterExtraDataForConsent', () => {
	// A representative ShowSuggestion payload: usage metadata + AI output + document text.
	const full = (): Record<string, unknown> => ({
		client_timestamp: 123,
		generation_type: 'example_sentences',
		result: { generation_type: 'example_sentences', result: 'AI text' },
		prompt: { beforeCursor: 'doc before', selectedText: '', afterCursor: 'doc after' },
		docContext: { beforeCursor: 'x', selectedText: '', afterCursor: 'y' },
	});

	it("drops the whole event at 'none'", () => {
		const r = filterExtraDataForConsent(full(), 'none');
		expect(r.allowed).toBe(false);
		expect(r.extraData).toEqual({});
	});

	it("at 'usage' keeps metadata but strips AI output and document content", () => {
		const r = filterExtraDataForConsent(full(), 'usage');
		expect(r.allowed).toBe(true);
		expect(r.extraData).toEqual({
			client_timestamp: 123,
			generation_type: 'example_sentences',
		});
		expect(r.strippedKeys.sort()).toEqual(['docContext', 'prompt', 'result']);
	});

	it("at 'ai_output' keeps AI output but still strips document content", () => {
		const r = filterExtraDataForConsent(full(), 'ai_output');
		expect(r.extraData.result).toBeDefined();
		expect(r.extraData.prompt).toBeUndefined();
		expect(r.extraData.docContext).toBeUndefined();
		expect(r.strippedKeys.sort()).toEqual(['docContext', 'prompt']);
	});

	it("at 'document' keeps everything", () => {
		const r = filterExtraDataForConsent(full(), 'document');
		expect(r.extraData).toEqual(full());
		expect(r.strippedKeys).toEqual([]);
	});

	it('treats unknown keys as usage-level metadata', () => {
		const r = filterExtraDataForConsent(
			{ event_specific_count: 4 } as Record<string, unknown>,
			'usage' as ConsentLevel,
		);
		expect(r.extraData.event_specific_count).toBe(4);
	});
});
