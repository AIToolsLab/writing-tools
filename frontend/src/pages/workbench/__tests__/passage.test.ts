import { describe, expect, it } from 'vitest';
import { extractPassage, followEdits, taskMessages } from '../passage';

const ctx = (before: string, selected: string, after: string) => ({
	beforeCursor: before,
	selectedText: selected,
	afterCursor: after,
});

describe('extractPassage', () => {
	const doc = ['First para.', '', 'One. Two is here! Three?', 'Last.'];

	it('takes the paragraph at the cursor and the one before it, skipping blank lines', () => {
		const before = `${doc[0]}\n\n${'One. Two'}`;
		const after = ` is here! Three?\n${doc[3]}`;
		const p = extractPassage(ctx(before, '', after), 'paragraph');
		expect(p).toEqual({
			text: 'One. Two is here! Three?',
			source: 'paragraph',
			previousParagraph: 'First para.',
		});
	});

	it('takes the sentence at the cursor', () => {
		const p = extractPassage(
			ctx('First para.\n\nOne. Tw', '', 'o is here! Three?'),
			'sentence',
		);
		expect(p.text).toBe('Two is here!');
	});

	it('prefers a selection', () => {
		const p = extractPassage(
			ctx('First para.\n\nOne. ', 'Two is', ' here!'),
			'sentence',
		);
		expect(p).toMatchObject({ text: 'Two is', source: 'selection' });
		expect(p.previousParagraph).toBe('First para.');
	});

	it('NFC-normalizes, since the tokenizer does', () => {
		const p = extractPassage(ctx('café', '', ''), 'paragraph');
		expect(p.text).toBe('café');
	});
});

describe('taskMessages', () => {
	it('puts stable context before the instruction and passage', () => {
		const [m] = taskMessages({
			instruction: 'Rewrite.',
			source: 'Text.',
			brief: 'Brief.',
			previousParagraph: 'Before.',
		});
		expect(m.role).toBe('user');
		expect(m.content.indexOf('Brief.')).toBeLessThan(
			m.content.indexOf('Before.'),
		);
		expect(m.content.endsWith('Rewrite.\n\nText.')).toBe(true);
	});

	it('omits what isn’t there', () => {
		const [m] = taskMessages({
			instruction: 'Rewrite.',
			source: 'Text.',
			brief: null,
			previousParagraph: '',
		});
		expect(m.content).toBe('Rewrite.\n\nText.');
	});
});

describe('followEdits', () => {
	const r = (start: number, end: number) => ({ start, end });
	it('shifts ranges after an edit and drops ones that overlap it', () => {
		// "aa bb cc" → "aa XXbb cc": insertion at 3.
		expect(
			followEdits('aa bb cc', 'aa XXbb cc', [r(0, 2), r(3, 5), r(6, 8)]),
		).toEqual([r(0, 2), r(5, 7), r(8, 10)]);
		// Replace "bb" with "b".
		expect(
			followEdits('aa bb cc', 'aa b cc', [r(0, 2), r(3, 5), r(6, 8)]),
		).toEqual([r(0, 2), r(5, 7)]);
	});
});
