/**
 * Headless-Lexical coverage for `$applySplice` — the node-incremental apply
 * that replaced the whole-document `setText` rewrite. Pins the two bugs that
 * rewrite caused: spurious empty paragraphs (the getTextContent `\n\n` join
 * vs. `\n` split mismatch) and destroyed node identity (cursor/undo).
 */
import {
	$createParagraphNode,
	$createTextNode,
	$getRoot,
	createEditor,
	type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';

import { lowerOp } from '@/pages/my-words/interaction/ops';
import { $applySplice } from '../editor';

function makeEditor(paras: string[]): LexicalEditor {
	const editor = createEditor({
		namespace: 'test',
		onError: (e) => {
			throw e;
		},
	});
	editor.update(
		() => {
			const root = $getRoot();
			for (const p of paras) {
				const node = $createParagraphNode();
				if (p.length > 0) node.append($createTextNode(p));
				root.append(node);
			}
		},
		{ discrete: true },
	);
	return editor;
}

const paragraphs = (editor: LexicalEditor) =>
	editor
		.getEditorState()
		.read(() => $getRoot().getChildren().map((n) => n.getTextContent()));

const paragraphKeys = (editor: LexicalEditor) =>
	editor
		.getEditorState()
		.read(() => $getRoot().getChildren().map((n) => n.getKey()));

const apply = (editor: LexicalEditor, splice: ParagraphSplice) =>
	editor.update(() => $applySplice(splice), { discrete: true });

describe('$applySplice', () => {
	it('changes one paragraph in place; untouched nodes keep their keys', () => {
		const editor = makeEditor(['first', 'the cat sat', 'last']);
		const before = paragraphKeys(editor);
		apply(editor, {
			index: 1,
			remove: ['the cat sat'],
			insert: ['the dog sat'],
		});
		expect(paragraphs(editor)).toEqual(['first', 'the dog sat', 'last']);
		const after = paragraphKeys(editor);
		expect(after).toEqual(before); // even the edited paragraph node survives
	});

	it('splits a paragraph without disturbing its neighbors', () => {
		const editor = makeEditor(['first', 'intro. And the rest', 'last']);
		const before = paragraphKeys(editor);
		apply(editor, {
			index: 1,
			remove: ['intro. And the rest'],
			insert: ['intro.', 'And the rest'],
		});
		expect(paragraphs(editor)).toEqual([
			'first',
			'intro.',
			'And the rest',
			'last',
		]);
		const after = paragraphKeys(editor);
		expect(after[0]).toBe(before[0]);
		expect(after[3]).toBe(before[2]);
	});

	it('merges two paragraphs into one', () => {
		const editor = makeEditor(['first half', 'second half', 'tail']);
		apply(editor, {
			index: 0,
			remove: ['first half', 'second half'],
			insert: ['first half, second half'],
		});
		expect(paragraphs(editor)).toEqual(['first half, second half', 'tail']);
	});

	it('grows at the start and end; removes paragraphs without residue', () => {
		const editor = makeEditor(['b']);
		apply(editor, { index: 0, remove: [], insert: ['a'] });
		apply(editor, { index: 2, remove: [], insert: ['c'] });
		expect(paragraphs(editor)).toEqual(['a', 'b', 'c']);
		apply(editor, { index: 1, remove: ['b'], insert: [] });
		expect(paragraphs(editor)).toEqual(['a', 'c']);
	});

	it('an unscoped str_replace never changes the paragraph count (the old setText bug)', () => {
		const doc = ['one two three', 'four five', 'six'];
		const editor = makeEditor(doc);
		for (const splice of lowerOp(doc, {
			kind: 'str_replace',
			oldStr: 'five',
			newStr: 'FIVE',
		}))
			apply(editor, splice);
		expect(paragraphs(editor)).toEqual(['one two three', 'four FIVE', 'six']);
		expect(paragraphs(editor)).toHaveLength(3);
	});
});
