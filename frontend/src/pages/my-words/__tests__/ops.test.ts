import { describe, expect, it } from 'vitest';

import { applyOp, describeOp, previewOp } from '../interaction/ops';

describe('applyOp', () => {
	it('str_replace replaces the first occurrence only', () => {
		expect(
			applyOp(['the cat sat', 'the cat ran'], {
				kind: 'str_replace',
				oldStr: 'cat',
				newStr: 'dog',
			}),
		).toEqual(['the dog sat', 'the cat ran']);
	});

	it('insert places a new paragraph after a numbered one', () => {
		expect(
			applyOp(['a', 'b'], {
				kind: 'insert',
				text: 'x',
				paragraph: 1,
				position: 'after',
			}),
		).toEqual(['a', 'x', 'b']);
	});

	it('insert with an anchor lands within the paragraph', () => {
		expect(
			applyOp(['hello world'], {
				kind: 'insert',
				text: ' big',
				after: 'hello',
			}),
		).toEqual(['hello big world']);
	});

	it('insert with no anchor appends at the end', () => {
		expect(applyOp(['a'], { kind: 'insert', text: 'b' })).toEqual([
			'a',
			'b',
		]);
	});

	it('move relocates a phrase and drops the emptied paragraph', () => {
		expect(
			applyOp(['keep this', 'move me'], {
				kind: 'move',
				phrase: 'move me',
				paragraph: 1,
				position: 'before',
			}),
		).toEqual(['move me', 'keep this']);
	});

	it('throws when the target text is absent', () => {
		expect(() =>
			applyOp(['a'], { kind: 'str_replace', oldStr: 'z', newStr: 'y' }),
		).toThrow();
	});
});

describe('previewOp', () => {
	it('computes the result without mutating the input', () => {
		const paras = ['a b c'];
		const { paragraphs, summary } = previewOp(paras, {
			kind: 'str_replace',
			oldStr: 'b',
			newStr: 'B',
		});
		expect(paragraphs).toEqual(['a B c']);
		expect(paras).toEqual(['a b c']); // untouched
		expect(summary).toBe(describeOp({ kind: 'str_replace', oldStr: 'b', newStr: 'B' }));
	});
});
