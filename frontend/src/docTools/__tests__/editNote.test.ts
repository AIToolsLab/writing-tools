import { describe, expect, it } from 'vitest';

import { diffParagraphs, editNote } from '../editNote';

describe('diffParagraphs', () => {
	it('finds nothing when the document is unchanged', () => {
		expect(diffParagraphs(['A.', 'B.'], ['A.', 'B.'])).toEqual([]);
	});

	it('pairs a removal and an addition in one place as a rewording', () => {
		expect(diffParagraphs(['A.', 'B.', 'C.'], ['A.', 'B!', 'C.'])).toEqual([
			{ kind: 'reworded', n: 2, old: 'B.', text: 'B!' },
		]);
	});

	it('numbers an addition by its place in the current document', () => {
		expect(diffParagraphs(['A.', 'C.'], ['A.', 'B.', 'C.'])).toEqual([
			{ kind: 'added', n: 2, text: 'B.' },
		]);
	});

	it('anchors a removal to the paragraph before it', () => {
		expect(diffParagraphs(['A.', 'B.', 'C.'], ['A.', 'C.'])).toEqual([
			{ kind: 'removed', after: 1, old: 'B.' },
		]);
		expect(diffParagraphs(['A.', 'B.'], ['B.'])).toEqual([
			{ kind: 'removed', after: 0, old: 'A.' },
		]);
	});

	it('ignores blank paragraphs but keeps real numbering', () => {
		expect(diffParagraphs(['A.', 'B.'], ['A.', '', 'B.', 'C.'])).toEqual([
			{ kind: 'added', n: 4, text: 'C.' },
		]);
	});

	it('reads a moved paragraph as a removal plus an addition', () => {
		const changes = diffParagraphs(['A.', 'B.', 'C.'], ['B.', 'C.', 'A.']);
		expect(changes).toEqual([
			{ kind: 'removed', after: 0, old: 'A.' },
			{ kind: 'added', n: 3, text: 'A.' },
		]);
	});
});

describe('editNote', () => {
	it('is null when nothing changed', () => {
		expect(editNote(['A.'], ['A.'])).toBeNull();
	});

	it('lists each change on its own line', () => {
		const note = editNote(['A.', 'B.', 'C.'], ['A.', 'B!', 'C.', 'D.']);
		expect(note).toContain('[2] reworded: "B!" (was "B.")');
		expect(note).toContain('[4] added: "D."');
	});

	it('falls back to "call view" past the size cap', () => {
		const long = (c: string) => c.repeat(300);
		const note = editNote(
			['a', 'b', 'c', 'd', 'e', 'f'].map(long),
			['g', 'h', 'i', 'j', 'k', 'l'].map(long),
		);
		expect(note).toMatch(/substantially; call `view`/);
	});
});
