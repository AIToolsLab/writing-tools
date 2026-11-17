import { describe, expect, it } from 'vitest';

import { applyOpLogged, applySplice } from '../ops';
import { previewChange, previewOpChanges } from '../preview';
import { captureUndo, planUndo } from '../undo';
import type { EditOp } from '../types';

describe('previewChange', () => {
	it('shows the changed words with clipped context', () => {
		const p = previewChange(
			'one two three four five six seven eight nine ten',
			'one two three four FIVE six seven eight nine ten',
			2,
		);
		expect(p).toMatchObject({
			before: 'three four ',
			removed: 'five',
			added: 'FIVE',
			after: ' six seven',
			clippedBefore: true,
			clippedAfter: true,
		});
	});

	it('widens a change inside a word to the whole word', () => {
		const p = previewChange('the cat sat', 'the cot sat');
		expect(p.removed).toBe('cat');
		expect(p.added).toBe('cot');
		expect(p.clippedBefore).toBe(false);
	});

	it('handles a pure insertion', () => {
		const p = previewChange('', 'A new paragraph.');
		expect(p).toMatchObject({ before: '', removed: '', added: 'A new paragraph.' });
	});
});

describe('previewOpChanges', () => {
	it('gives a move two previews: where it leaves and where it lands', () => {
		const previews = previewOpChanges(['A.', 'B.', 'C.'], {
			kind: 'move',
			phrase: 'A.',
			paragraph: 2,
		});
		expect(previews).toHaveLength(2);
		expect(previews[0].removed).toBe('A.');
		expect(previews[1].added).toBe('A.');
	});
});

/** Apply an op, capturing its undo as Chat does. */
function logged(doc: string[], op: EditOp) {
	const { after, splices } = applyOpLogged(doc, op);
	return { after, undo: captureUndo(after, splices) };
}

describe('planUndo', () => {
	const doc = ['Intro.', 'The cat sat.', 'End.'];
	const replace = logged(doc, {
		kind: 'str_replace',
		oldStr: 'cat',
		newStr: 'dog',
	});

	it('undoes in place when nothing else changed', () => {
		const plan = planUndo(replace.after, replace.undo);
		expect(plan).not.toBeNull();
		expect(plan!.reduce(applySplice, replace.after)).toEqual(doc);
	});

	it('relocates after a later edit shifted the paragraphs', () => {
		const shifted = ['New first.', ...replace.after];
		const plan = planUndo(shifted, replace.undo);
		expect(plan!.reduce(applySplice, shifted)).toEqual(['New first.', ...doc]);
	});

	it('refuses when the writer has changed the edited text since', () => {
		const edited = ['Intro.', 'The dog sat down.', 'End.'];
		expect(planUndo(edited, replace.undo)).toBeNull();
	});

	it('refuses when the edited text now occurs more than once', () => {
		const twice = [...replace.after, 'The dog sat.'];
		const shifted = ['Top.', ...twice];
		expect(planUndo(shifted, replace.undo)).toBeNull();
	});

	it('undoes a move completely', () => {
		const moved = logged(doc, {
			kind: 'move',
			phrase: 'Intro.',
			paragraph: 2,
		});
		const plan = planUndo(moved.after, moved.undo);
		expect(plan!.reduce(applySplice, moved.after)).toEqual(doc);
	});

	describe('a move, after later changes', () => {
		const four = ['A.', 'B.', 'C.', 'D.'];
		const moved = logged(four, {
			kind: 'move',
			phrase: 'D.',
			paragraph: 1,
			position: 'before',
		});

		it('puts the paragraph back between its old neighbors', () => {
			const shifted = ['New.', ...moved.after];
			const plan = planUndo(shifted, moved.undo);
			expect(plan!.reduce(applySplice, shifted)).toEqual(['New.', ...four]);
		});

		it('refuses when the text at its old spot has changed', () => {
			const edited = moved.after.map((p) => (p === 'C.' ? 'C, edited.' : p));
			expect(planUndo(edited, moved.undo)).toBeNull();
		});
	});

	it('undoes a move after an edit away from the spot', () => {
		const long = [
			'An opening paragraph, long enough that its start is out of range.',
			'Moved.',
			'A closing paragraph, also long enough to have a middle of its own.',
		];
		const moved = logged(long, {
			kind: 'move',
			phrase: 'Moved.',
			paragraph: 1,
			position: 'before',
		});
		const edited = moved.after.map((p) =>
			p.replace('An opening', 'The first'),
		);
		const plan = planUndo(edited, moved.undo);
		expect(plan!.reduce(applySplice, edited)).toEqual([
			'The first paragraph, long enough that its start is out of range.',
			'Moved.',
			'A closing paragraph, also long enough to have a middle of its own.',
		]);
	});

	describe('a move next to blank paragraphs', () => {
		const spaced = ['First paragraph.', '', 'Second paragraph.', '', 'Last.'];
		const moved = logged(spaced, {
			kind: 'move',
			phrase: 'Second paragraph.',
			paragraph: 1,
			position: 'before',
		});

		it('finds its spot by the text past the blank lines', () => {
			const shifted = ['New.', '', ...moved.after];
			const plan = planUndo(shifted, moved.undo);
			expect(plan!.reduce(applySplice, shifted)).toEqual([
				'New.',
				'',
				...spaced,
			]);
		});

		it('refuses when a blank line at the spot was removed', () => {
			const at = moved.after.indexOf('First paragraph.') + 1;
			const closed = moved.after.filter((_, i) => i !== at);
			expect(planUndo(closed, moved.undo)).toBeNull();
		});
	});
});
