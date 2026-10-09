import { describe, expect, it } from 'vitest';

import {
	applyOp,
	applyOpLogged,
	applySplice,
	describeOp,
	invertSplices,
	lowerOp,
	previewOp,
	spliceIsFresh,
} from '../interaction/ops';
import type { EditOp } from '../interaction/types';

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

	it('str_replace scoped to a paragraph only touches that paragraph', () => {
		expect(
			applyOp(['the cat', 'the cat'], {
				kind: 'str_replace',
				oldStr: 'cat',
				newStr: 'dog',
				paragraph: 2,
			}),
		).toEqual(['the cat', 'the dog']);
	});

	it('scoped str_replace throws when the text is not in that paragraph', () => {
		expect(() =>
			applyOp(['the cat', 'the dog'], {
				kind: 'str_replace',
				oldStr: 'cat',
				newStr: 'lion',
				paragraph: 2,
			}),
		).toThrow(/paragraph 2/);
	});
});

describe('tolerant targeting', () => {
	// The model utters the writer's phrase back with its own typography — a
	// straight apostrophe where Word autocorrected a curly one, a hyphen where
	// the transcriber heard two words. Those are the same phrase, and treating
	// them as a miss was costing edits that were otherwise right.
	it('finds a hyphenated phrase the model spelled with a space', () => {
		expect(
			applyOp(['their well-being matters most'], {
				kind: 'str_replace',
				oldStr: 'well being',
				newStr: 'well-being',
			}),
		).toEqual(['their well-being matters most']);
	});

	it('finds a spaced phrase the model spelled with a hyphen', () => {
		expect(
			applyOp(['a state of the art result'], {
				kind: 'str_replace',
				oldStr: 'state-of-the-art',
				newStr: 'state of the art',
			}),
		).toEqual(['a state of the art result']);
	});

	it('finds a curly apostrophe behind a straight one', () => {
		expect(
			applyOp(['I don’t think so'], {
				kind: 'str_replace',
				oldStr: "don't think",
				newStr: 'think',
			}),
		).toEqual(['I think so']);
	});

	it('replaces the writer’s real characters, not the needle’s', () => {
		// The span is located leniently but sliced from the source, so the en
		// dash goes away with the rest of the matched text.
		expect(
			applyOp(['the well–being section'], {
				kind: 'str_replace',
				oldStr: 'well-being',
				newStr: 'wellness',
			}),
		).toEqual(['the wellness section']);
	});

	it('still prefers an exact match elsewhere over a folded one', () => {
		expect(
			applyOp(['a well-being note', 'a well being note'], {
				kind: 'str_replace',
				oldStr: 'well being',
				newStr: 'health',
			}),
		).toEqual(['a well-being note', 'a health note']);
	});

	it('move carries the writer’s characters, not the needle’s', () => {
		// A move adds no words; it must not restyle the ones it relocates.
		expect(
			applyOp(['keep this', 'their well-being'], {
				kind: 'move',
				phrase: 'well being',
				paragraph: 1,
				position: 'before',
			}),
		).toEqual(['well-being', 'keep this', 'their ']);
	});

	it('keeps a genuine miss a miss', () => {
		expect(() =>
			applyOp(['the cat sat'], {
				kind: 'str_replace',
				oldStr: 'the dog sat',
				newStr: 'x',
			}),
		).toThrow(/not found in the document/);
	});

	it('honors paragraph scoping when matching leniently', () => {
		expect(() =>
			applyOp(['well-being', 'nothing here'], {
				kind: 'str_replace',
				oldStr: 'well being',
				newStr: 'health',
				paragraph: 2,
			}),
		).toThrow(/paragraph 2/);
	});
});

describe('newline lowering (splits and merges)', () => {
	it('a newline in newStr splits the paragraph', () => {
		expect(
			applyOp(['intro and the rest', 'tail'], {
				kind: 'str_replace',
				oldStr: ' and ',
				newStr: '.\nAnd ',
				paragraph: 1,
			}),
		).toEqual(['intro.', 'And the rest', 'tail']);
	});

	it('a newline in oldStr matches across the boundary and merges', () => {
		expect(
			applyOp(['first half', 'second half', 'tail'], {
				kind: 'str_replace',
				oldStr: 'half\nsecond',
				newStr: 'half, second',
			}),
		).toEqual(['first half, second half', 'tail']);
	});

	it('runs of newlines count as one paragraph break', () => {
		expect(
			applyOp(['a'], {
				kind: 'insert',
				text: 'x\n\n\ny\n',
				paragraph: 1,
			}),
		).toEqual(['a', 'x', 'y']);
	});

	it('scoped cross-boundary match must start in that paragraph', () => {
		expect(() =>
			applyOp(['a b', 'c d'], {
				kind: 'str_replace',
				oldStr: 'b\nc',
				newStr: 'b c',
				paragraph: 2,
			}),
		).toThrow(/paragraph 2/);
	});

	it('inline insert (after) can split its paragraph', () => {
		expect(
			applyOp(['hello world'], {
				kind: 'insert',
				text: ' there\nnew line',
				after: 'hello',
			}),
		).toEqual(['hello there', 'new line world']);
	});
});

describe('splice logging and undo', () => {
	const roundTrip = (before: string[], op: EditOp) => {
		const { after, undo } = applyOpLogged(before, op);
		expect(undo.reduce(applySplice, after)).toEqual(before);
		return { after, undo };
	};

	it('undo restores exactly: str_replace', () => {
		roundTrip(['the cat sat'], {
			kind: 'str_replace',
			oldStr: 'cat',
			newStr: 'dog',
		});
	});

	it('undo restores exactly: paragraph insert (no empty residue)', () => {
		const { after, undo } = roundTrip(['a', 'b'], {
			kind: 'insert',
			text: 'x',
			paragraph: 1,
		});
		expect(after).toEqual(['a', 'x', 'b']);
		expect(undo.reduce(applySplice, after)).toHaveLength(2);
	});

	it('undo restores exactly: move that emptied a paragraph', () => {
		roundTrip(['keep this', 'move me'], {
			kind: 'move',
			phrase: 'move me',
			paragraph: 1,
			position: 'before',
		});
	});

	it('undo restores exactly: split and merge', () => {
		roundTrip(['one two three'], {
			kind: 'str_replace',
			oldStr: ' two ',
			newStr: '\n',
		});
		roundTrip(['one', 'two'], {
			kind: 'str_replace',
			oldStr: 'one\ntwo',
			newStr: 'one two',
		});
	});

	it('spliceIsFresh refuses after the range is mutated', () => {
		const before = ['a', 'b'];
		const { after, undo } = applyOpLogged(before, {
			kind: 'str_replace',
			oldStr: 'b',
			newStr: 'B',
		});
		expect(undo.every((s) => spliceIsFresh(after, s))).toBe(true);
		const tampered = [...after];
		tampered[1] = 'hand-edited';
		expect(undo.every((s) => spliceIsFresh(tampered, s))).toBe(false);
	});

	it('lowerOp throws on a miss without partial application', () => {
		expect(() =>
			lowerOp(['a'], { kind: 'str_replace', oldStr: 'zz', newStr: 'y' }),
		).toThrow(/not found in the document/);
	});

	it('invertSplices reverses order for multi-splice ops', () => {
		const splices = lowerOp(['keep this', 'move me'], {
			kind: 'move',
			phrase: 'move me',
			paragraph: 1,
			position: 'before',
		});
		expect(splices).toHaveLength(2);
		const undo = invertSplices(splices);
		expect(undo[0].index).toBe(splices[1].index);
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
		expect(summary).toBe(
			describeOp({ kind: 'str_replace', oldStr: 'b', newStr: 'B' }),
		);
	});
});
