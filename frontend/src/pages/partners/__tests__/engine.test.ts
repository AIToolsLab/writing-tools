import { describe, expect, it } from 'vitest';
import {
	MAX_ACTIVATIONS,
	parseDecision,
	parseSuggestion,
	renderDocument,
} from '../engine';

const KNOWN = new Set(['a', 'b', 'c']);

describe('parseDecision', () => {
	it('reads a plain decision', () => {
		expect(
			parseDecision('{"activate":[{"id":"a","why":"no evidence yet"}]}', KNOWN),
		).toEqual([{ id: 'a', why: 'no evidence yet' }]);
	});

	it('reads silence', () => {
		expect(parseDecision('{"activate":[]}', KNOWN)).toEqual([]);
	});

	it('unwraps a fenced code block', () => {
		expect(
			parseDecision('```json\n{"activate":[{"id":"b","why":"x"}]}\n```', KNOWN),
		).toEqual([{ id: 'b', why: 'x' }]);
	});

	it('tolerates a preamble around the object', () => {
		expect(
			parseDecision('Sure! {"activate":[{"id":"c","why":"y"}]} Hope that helps.', KNOWN),
		).toEqual([{ id: 'c', why: 'y' }]);
	});

	it('drops ids the writer never configured', () => {
		expect(
			parseDecision(
				'{"activate":[{"id":"ghost","why":"x"},{"id":"a","why":"y"}]}',
				KNOWN,
			),
		).toEqual([{ id: 'a', why: 'y' }]);
	});

	it('drops a repeated id', () => {
		expect(
			parseDecision(
				'{"activate":[{"id":"a","why":"x"},{"id":"a","why":"y"}]}',
				KNOWN,
			),
		).toEqual([{ id: 'a', why: 'x' }]);
	});

	it("enforces the paper's cap of two", () => {
		const choices = parseDecision(
			'{"activate":[{"id":"a"},{"id":"b"},{"id":"c"}]}',
			KNOWN,
		);
		expect(choices).toHaveLength(MAX_ACTIVATIONS);
		expect(choices.map((c) => c.id)).toEqual(['a', 'b']);
	});

	it('survives a reply that is not JSON at all', () => {
		expect(parseDecision('I think nobody should speak.', KNOWN)).toEqual([]);
		expect(parseDecision('', KNOWN)).toEqual([]);
		expect(parseDecision('{ not json }', KNOWN)).toEqual([]);
	});
});

describe('parseSuggestion', () => {
	it('reads both parts', () => {
		expect(
			parseSuggestion(
				'{"acknowledgement":"You just moved to examples.","question":"Which one?"}',
			),
		).toEqual({
			acknowledgement: 'You just moved to examples.',
			question: 'Which one?',
		});
	});

	it('falls back to prose as the question', () => {
		// A partner that said something beats an error card.
		expect(parseSuggestion('What would change if you led with the claim?')).toEqual(
			{
				acknowledgement: '',
				question: 'What would change if you led with the claim?',
			},
		);
	});

	it('keeps whichever half the model supplied', () => {
		expect(parseSuggestion('{"question":"Why now?"}')).toEqual({
			acknowledgement: '',
			question: 'Why now?',
		});
	});
});

describe('renderDocument', () => {
	it('marks the cursor', () => {
		expect(
			renderDocument({
				at: 0,
				beforeCursor: 'One. ',
				selectedText: '',
				afterCursor: 'Two.',
			}),
		).toBe('One. <<CURSOR>>Two.');
	});

	it('marks a selection instead', () => {
		expect(
			renderDocument({
				at: 0,
				beforeCursor: 'One ',
				selectedText: 'big',
				afterCursor: ' claim',
			}),
		).toBe('One <<SELECTION>>big<</SELECTION>> claim');
	});

	it('truncates a long document around the cursor', () => {
		const rendered = renderDocument({
			at: 0,
			beforeCursor: 'x'.repeat(5_000),
			selectedText: '',
			afterCursor: 'y'.repeat(5_000),
		});
		expect(rendered.startsWith('…')).toBe(true);
		expect(rendered.endsWith('…')).toBe(true);
		expect(rendered.length).toBeLessThan(4_100);
	});
});
