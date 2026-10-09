/**
 * Tests for the Google Docs add-on's Markdown serialization
 * (`google-docs-addon/Code.gs`), run against the real file — see
 * `helpers/appsScript.ts` for how and why.
 *
 * What these pin down is the mapping from what a writer marked in Docs to what
 * the model reads. Two properties matter beyond any individual glyph:
 *
 *   1. Structure the writer marked survives. A heading arrives as a heading.
 *   2. `beforeCursor + selectedText + afterCursor` is exactly the document.
 *      Every caller assumes it (`getDocText` concatenates the three), and the
 *      old string-search positioning quietly broke it.
 */
import { describe, expect, it } from 'vitest';

import {
	body,
	cursor,
	documentWith,
	GlyphType,
	listItem,
	loadAddonScript,
	paragraph,
	ParagraphHeading,
	rangeElement,
	selection,
	table,
} from './helpers/appsScript';

describe('headings', () => {
	it('maps each Docs heading level to its Markdown depth', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([
				paragraph('Chapter', ParagraphHeading.HEADING1),
				paragraph('Section', ParagraphHeading.HEADING2),
				paragraph('Sub', ParagraphHeading.HEADING3),
				paragraph('Deeper', ParagraphHeading.HEADING4),
				paragraph('Deepest', ParagraphHeading.HEADING6),
			]),
		);

		expect(markdown).toBe(
			[
				'# Chapter',
				'## Section',
				'### Sub',
				'#### Deeper',
				'###### Deepest',
			].join('\n\n'),
		);
	});

	it('leaves body text unprefixed', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([paragraph('Just some prose.', ParagraphHeading.NORMAL)]),
		);

		expect(markdown).toBe('Just some prose.');
	});

	it('flattens Title to a top-level heading and Subtitle to a paragraph', () => {
		// Deliberate lossiness: Markdown has no subtitle, and Docs' Subtitle is
		// not an outline level, so it must not claim a section boundary.
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([
				paragraph('The Title', ParagraphHeading.TITLE),
				paragraph('A subtitle', ParagraphHeading.SUBTITLE),
			]),
		);

		expect(markdown).toBe('# The Title\n\nA subtitle');
	});

	it('treats an unrecognized named style as body text', () => {
		const script = loadAddonScript();
		// Anything a future Docs version adds must degrade to a plain paragraph
		// rather than crash the whole serialization.
		expect(script.headingPrefix('SOMETHING_NEW' as never)).toBe('');
	});
});

describe('lists', () => {
	it('maps every bullet glyph to a dash', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([
				listItem('Round', { glyph: GlyphType.BULLET }),
				listItem('Hollow', { glyph: GlyphType.HOLLOW_BULLET }),
				listItem('Square', { glyph: GlyphType.SQUARE_BULLET }),
			]),
		);

		expect(markdown).toBe('- Round\n- Hollow\n- Square');
	});

	it('numbers ordered items sequentially', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([
				listItem('First', { glyph: GlyphType.NUMBER }),
				listItem('Second', { glyph: GlyphType.NUMBER }),
				listItem('Third', { glyph: GlyphType.NUMBER }),
			]),
		);

		expect(markdown).toBe('1. First\n2. Second\n3. Third');
	});

	it('maps latin and roman glyphs to ordinary numbering', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([
				listItem('Alpha', { glyph: GlyphType.LATIN_LOWER }),
				listItem('Beta', { glyph: GlyphType.ROMAN_UPPER }),
			]),
		);

		expect(markdown).toBe('1. Alpha\n2. Beta');
	});

	it('indents nested items and restarts deeper numbering', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([
				listItem('One', { glyph: GlyphType.NUMBER, level: 0 }),
				listItem('One A', { glyph: GlyphType.NUMBER, level: 1 }),
				listItem('One B', { glyph: GlyphType.NUMBER, level: 1 }),
				listItem('Two', { glyph: GlyphType.NUMBER, level: 0 }),
				listItem('Two A', { glyph: GlyphType.NUMBER, level: 1 }),
			]),
		);

		expect(markdown).toBe(
			[
				'1. One',
				'    1. One A',
				'    2. One B',
				'2. Two',
				'    1. Two A',
			].join('\n'),
		);
	});

	it('counts separate lists separately', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([
				listItem('A1', { glyph: GlyphType.NUMBER, listId: 'a' }),
				listItem('A2', { glyph: GlyphType.NUMBER, listId: 'a' }),
				paragraph('An interruption.'),
				listItem('B1', { glyph: GlyphType.NUMBER, listId: 'b' }),
			]),
		);

		expect(markdown).toBe('1. A1\n2. A2\n\nAn interruption.\n\n1. B1');
	});

	it('keeps list items adjacent but separates them from prose', () => {
		// A blank line between items would end the list; a missing one between
		// the list and the paragraph would swallow the paragraph into it.
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([
				paragraph('Before:'),
				listItem('One'),
				listItem('Two'),
				paragraph('After.'),
			]),
		);

		expect(markdown).toBe('Before:\n\n- One\n- Two\n\nAfter.');
	});
});

describe('block separation', () => {
	it('separates paragraphs with a blank line', () => {
		// The bug this replaces: paragraph text was concatenated with no
		// separator at all, because DocumentApp text carries no trailing
		// newline. Two paragraphs arrived as one run-on sentence.
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([paragraph('First para.'), paragraph('Second para.')]),
		);

		expect(markdown).toBe('First para.\n\nSecond para.');
	});

	it('does not emit extra blank lines for spacing paragraphs', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([paragraph('First.'), paragraph(''), paragraph('Second.')]),
		);

		expect(markdown).toBe('First.\n\nSecond.');
	});

	it('skips tables and other non-text children', () => {
		const script = loadAddonScript();
		const markdown = script.bodyToMarkdown(
			body([paragraph('Before.'), table(), paragraph('After.')]),
		);

		expect(markdown).toBe('Before.\n\nAfter.');
	});

	it('serializes an empty document to an empty string', () => {
		const script = loadAddonScript();
		expect(script.bodyToMarkdown(body([]))).toBe('');
	});
});

describe('getDocContext positioning', () => {
	/** Every context must reassemble into exactly the serialized document. */
	function expectPartition(
		context: {
			beforeCursor: string;
			selectedText: string;
			afterCursor: string;
		},
		markdown: string,
	) {
		expect(
			context.beforeCursor + context.selectedText + context.afterCursor,
		).toBe(markdown);
	}

	it('places a cursor at its offset within the paragraph text', () => {
		const script = loadAddonScript();
		const intro = paragraph('Hello world');
		const rest = paragraph('Second.');
		const docBody = body([intro, rest]);
		script.setActiveDocument(
			documentWith(docBody, { cursor: cursor(intro.text, 5) }),
		);

		const context = script.getDocContext();

		expect(context.beforeCursor).toBe('Hello');
		expect(context.selectedText).toBe('');
		expect(context.afterCursor).toBe(' world\n\nSecond.');
		expectPartition(context, script.bodyToMarkdown(docBody));
	});

	it('counts the Markdown prefix as before the cursor', () => {
		// The cursor's offset is into the writer's text, which starts after the
		// `## ` we inserted. Adding the prefix length is what keeps them aligned.
		const script = loadAddonScript();
		const heading = paragraph('Section title', ParagraphHeading.HEADING2);
		const docBody = body([heading]);
		script.setActiveDocument(
			documentWith(docBody, { cursor: cursor(heading.text, 7) }),
		);

		const context = script.getDocContext();

		expect(context.beforeCursor).toBe('## Section');
		expect(context.afterCursor).toBe(' title');
	});

	it('locates a partial selection precisely', () => {
		const script = loadAddonScript();
		const only = paragraph('The quick brown fox');
		const docBody = body([only]);
		script.setActiveDocument(
			documentWith(docBody, {
				selection: selection([
					rangeElement(only.text, { start: 4, endInclusive: 8 }),
				]),
			}),
		);

		const context = script.getDocContext();

		expect(context.beforeCursor).toBe('The ');
		expect(context.selectedText).toBe('quick');
		expect(context.afterCursor).toBe(' brown fox');
		expectPartition(context, script.bodyToMarkdown(docBody));
	});

	it('spans multiple blocks, prefixes included', () => {
		const script = loadAddonScript();
		const heading = paragraph('Title here', ParagraphHeading.HEADING2);
		const item = listItem('A point');
		const docBody = body([
			paragraph('Intro.'),
			heading,
			item,
			paragraph('End.'),
		]);
		script.setActiveDocument(
			documentWith(docBody, {
				selection: selection([
					rangeElement(heading),
					rangeElement(item),
				]),
			}),
		);

		const context = script.getDocContext();

		expect(context.beforeCursor).toBe('Intro.\n\n');
		expect(context.selectedText).toBe('## Title here\n\n- A point');
		expect(context.afterCursor).toBe('\n\nEnd.');
		expectPartition(context, script.bodyToMarkdown(docBody));
	});

	it('does not mislocate a phrase that occurs twice', () => {
		// The old implementation searched the document for the selected string,
		// so selecting the *second* "the plan" reported the first one's position.
		const script = loadAddonScript();
		const first = paragraph('We discussed the plan');
		const second = paragraph('We revisited the plan');
		const docBody = body([first, second]);
		script.setActiveDocument(
			documentWith(docBody, {
				selection: selection([
					rangeElement(second.text, { start: 13, endInclusive: 20 }),
				]),
			}),
		);

		const context = script.getDocContext();

		expect(context.selectedText).toBe('the plan');
		expect(context.beforeCursor).toBe(
			'We discussed the plan\n\nWe revisited ',
		);
		expect(context.afterCursor).toBe('');
	});

	it('returns the whole document as "before" when nothing is focused', () => {
		const script = loadAddonScript();
		const docBody = body([paragraph('Alone.')]);
		script.setActiveDocument(documentWith(docBody));

		const context = script.getDocContext();

		expect(context.beforeCursor).toBe('Alone.');
		expect(context.selectedText).toBe('');
		expect(context.afterCursor).toBe('');
	});

	it('falls back to the whole document when a position cannot be placed', () => {
		// An element outside the body (a header, a footnote) has no offset in the
		// body's Markdown. Degrading to "everything is before" beats throwing,
		// which would take the sidebar down.
		const script = loadAddonScript();
		const orphan = paragraph('Detached');
		const docBody = body([paragraph('Real content.')]);
		script.setActiveDocument(
			documentWith(docBody, { cursor: cursor(orphan.text, 2) }),
		);

		const context = script.getDocContext();

		expect(context.beforeCursor).toBe('Real content.');
		expect(context.selectedText).toBe('');
	});
});
