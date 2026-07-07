import { describe, expect, it } from 'vitest';

import {
	applySpliceToEditor,
	minimalReplace,
} from '../interaction/editor';
import { applyOp, applySplice, lowerOp } from '../interaction/ops';

/**
 * A host WITHOUT native applySplice: applies DocEdit primitives through the
 * same pure ops (plus delete_paragraph), the way Word does through Office.js.
 * Exercises the fallback path of `applySpliceToEditor`.
 */
function primitiveHost(initial: string[]) {
	let paragraphs = [...initial];
	const editor = {
		applyEdit: async (edit: DocEdit) => {
			if (edit.type === 'delete_paragraph') {
				if (edit.paragraph < 1 || edit.paragraph > paragraphs.length)
					throw new Error(`Paragraph ${edit.paragraph} out of range.`);
				paragraphs = [
					...paragraphs.slice(0, edit.paragraph - 1),
					...paragraphs.slice(edit.paragraph),
				];
				return;
			}
			paragraphs = applyOp(
				paragraphs,
				edit.type === 'str_replace'
					? {
							kind: 'str_replace',
							oldStr: edit.oldStr,
							newStr: edit.newStr,
							paragraph: edit.paragraph,
						}
					: {
							kind: 'insert',
							text: edit.text,
							after: edit.after,
							paragraph: edit.paragraph,
							position: edit.position,
						},
			);
		},
		getParagraphs: async () => [...paragraphs],
	} as unknown as EditorAPI;
	return { editor, current: () => paragraphs };
}

describe('applySpliceToEditor fallback (DocEdit primitives)', () => {
	const cases: { name: string; before: string[]; splice: ParagraphSplice }[] = [
		{
			name: 'in-place text change',
			before: ['the cat sat', 'tail'],
			splice: { index: 0, remove: ['the cat sat'], insert: ['the dog sat'] },
		},
		{
			name: 'replace a repeated span (second occurrence)',
			before: ['aa b aa', 'tail'],
			splice: { index: 0, remove: ['aa b aa'], insert: ['aa b cc'] },
		},
		{
			name: 'pure insertion in the middle of a paragraph',
			before: ['hello world'],
			splice: { index: 0, remove: ['hello world'], insert: ['hello big world'] },
		},
		{
			name: 'split: one paragraph becomes two',
			before: ['intro. And the rest', 'tail'],
			splice: {
				index: 0,
				remove: ['intro. And the rest'],
				insert: ['intro.', 'And the rest'],
			},
		},
		{
			name: 'merge: two paragraphs become one',
			before: ['first half', 'second half', 'tail'],
			splice: {
				index: 0,
				remove: ['first half', 'second half'],
				insert: ['first half, second half'],
			},
		},
		{
			name: 'grow at the very start',
			before: ['b'],
			splice: { index: 0, remove: [], insert: ['a'] },
		},
		{
			name: 'append at the end',
			before: ['a'],
			splice: { index: 1, remove: [], insert: ['b', 'c'] },
		},
		{
			name: 'delete a paragraph outright',
			before: ['a', 'gone', 'b'],
			splice: { index: 1, remove: ['gone'], insert: [] },
		},
		{
			name: 'empty paragraph gaining text',
			before: ['a', '', 'b'],
			splice: { index: 1, remove: [''], insert: ['filled'] },
		},
	];

	for (const { name, before, splice } of cases) {
		it(name, async () => {
			const { editor, current } = primitiveHost(before);
			await applySpliceToEditor(editor, splice);
			expect(current()).toEqual(applySplice(before, splice));
		});
	}

	it('matches the native path for every lowered op', async () => {
		const before = ['one two three', 'four five', 'six'];
		const ops = [
			{ kind: 'str_replace', oldStr: 'two', newStr: 'TWO' },
			{ kind: 'str_replace', oldStr: ' two ', newStr: '\n' },
			{ kind: 'str_replace', oldStr: 'three\nfour', newStr: 'three four' },
			{ kind: 'insert', text: 'zero', paragraph: 1, position: 'before' },
			{ kind: 'move', phrase: 'six', paragraph: 1, position: 'before' },
		] as const;
		for (const op of ops) {
			const { editor, current } = primitiveHost(before);
			for (const splice of lowerOp(before, op))
				await applySpliceToEditor(editor, splice);
			expect(current()).toEqual(applyOp(before, op));
		}
	});
});

describe('minimalReplace', () => {
	it('trims the common prefix and suffix', () => {
		expect(minimalReplace('the cat sat', 'the dog sat')).toEqual({
			oldStr: 'cat',
			newStr: 'dog',
		});
	});

	it('never returns an empty needle for pure insertions', () => {
		const { oldStr, newStr } = minimalReplace('ab', 'axb');
		expect(oldStr.length).toBeGreaterThan(0);
		expect('ab'.replace(oldStr, newStr)).toBe('axb');
	});

	it('extends the needle so the FIRST occurrence is the right one', () => {
		const { oldStr, newStr } = minimalReplace('aa b aa', 'aa b cc');
		expect('aa b aa'.replace(oldStr, newStr)).toBe('aa b cc');
	});
});
