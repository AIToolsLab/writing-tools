import { describe, expect, it } from 'vitest';

import { applyOpLogged, applySplice } from '../ops';
import { previewChange, previewOpChanges } from '../preview';
import { planUndo } from '../undo';

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

describe('planUndo', () => {
	const doc = ['Intro.', 'The cat sat.', 'End.'];
	const replace = applyOpLogged(doc, {
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
		const moved = applyOpLogged(doc, {
			kind: 'move',
			phrase: 'Intro.',
			paragraph: 2,
		});
		const plan = planUndo(moved.after, moved.undo);
		expect(plan!.reduce(applySplice, moved.after)).toEqual(doc);
	});
});
