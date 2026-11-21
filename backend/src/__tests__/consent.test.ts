import { describe, expect, it } from 'vitest';
import {
	type ConsentLevel,
	consentRank,
	filterLogPayloadForConsent,
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

describe('filterLogPayloadForConsent', () => {
	// A representative suggestion_shown payload, one field per bucket.
	const full = (): Record<string, unknown> => ({
		usage: { generationType: 'example_sentences', features: ['a', 'b'] },
		ai_output: { result: { generation_type: 'example_sentences', result: 'AI text' } },
		document: { docContext: { beforeCursor: 'x', selectedText: '', afterCursor: 'y' } },
	});

	it("drops the whole event at 'none'", () => {
		const r = filterLogPayloadForConsent(full(), 'none');
		expect(r.allowed).toBe(false);
		expect(r.buckets).toEqual({});
	});

	it("at 'usage' keeps only the usage bucket", () => {
		const r = filterLogPayloadForConsent(full(), 'usage');
		expect(r.allowed).toBe(true);
		expect(r.buckets).toEqual({ usage: full().usage });
		expect(r.unclassified).toEqual([]);
	});

	it("at 'ai_output' adds AI output but not the writer's text", () => {
		const r = filterLogPayloadForConsent(full(), 'ai_output');
		expect(Object.keys(r.buckets).sort()).toEqual(['ai_output', 'usage']);
	});

	it("at 'document' keeps every bucket", () => {
		const r = filterLogPayloadForConsent(full(), 'document');
		expect(r.buckets).toEqual(full());
	});

	it('drops an unregistered top-level key at every level (#615)', () => {
		for (const level of ['usage', 'ai_output', 'document'] as ConsentLevel[]) {
			const r = filterLogPayloadForConsent({ brief: 'my thesis', usage: {} }, level);
			expect(r.buckets).toEqual({ usage: {} });
			expect(r.unclassified).toEqual(['brief']);
		}
	});

	it('drops nested values from usage, where document text would hide', () => {
		const r = filterLogPayloadForConsent(
			{ usage: { count: 4, ok: true, none: null, docContext: { beforeCursor: 'x' }, mixed: [1, { a: 1 }] } },
			'document',
		);
		expect(r.buckets.usage).toEqual({ count: 4, ok: true, none: null });
		expect(r.unclassified).toEqual(['usage.docContext', 'usage.mixed']);
	});

	it('drops a bucket that is not an object', () => {
		const r = filterLogPayloadForConsent({ document: 'raw text' }, 'document');
		expect(r.buckets).toEqual({});
		expect(r.unclassified).toEqual(['document']);
	});
});
