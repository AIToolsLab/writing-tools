/**
 * A test harness for `google-docs-addon/Code.gs`.
 *
 * The add-on's Markdown serialization is the only genuinely tricky logic in the
 * Google Docs surface, and it is also the logic that is most expensive to check
 * by hand: verifying it in place means `clasp push`, reloading the sidebar, and
 * reading the result through a UI. That loop is far too slow to iterate a glyph
 * table on.
 *
 * So we run the real file here. `Code.gs` is plain ES2015 that only touches
 * Apps Script through globals, so evaluating it with a stubbed `DocumentApp`
 * gives us the shipped source under test — not a copy that can drift from it.
 * The alternative, extracting the serializer into a module both the add-on and
 * the tests import, would mean either a second npm package for a folder clasp
 * pushes verbatim or a `module.exports` guard in code that has no module
 * system. Evaluating the file avoids both and keeps `Code.gs` readable as what
 * it is: an Apps Script file.
 *
 * The fakes below implement only the element methods `Code.gs` actually calls.
 * They are duck types, not a DocumentApp emulator — anything the serializer
 * starts calling has to be added here, which is the intended pressure.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODE_GS = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../../../../../google-docs-addon/Code.gs',
);

/** Enum values are compared by identity in Code.gs, so plain strings suffice. */
export const ElementType = {
	BODY_SECTION: 'BODY_SECTION',
	PARAGRAPH: 'PARAGRAPH',
	LIST_ITEM: 'LIST_ITEM',
	TEXT: 'TEXT',
	TABLE: 'TABLE',
	INLINE_IMAGE: 'INLINE_IMAGE',
} as const;

export const ParagraphHeading = {
	NORMAL: 'NORMAL',
	TITLE: 'TITLE',
	SUBTITLE: 'SUBTITLE',
	HEADING1: 'HEADING1',
	HEADING2: 'HEADING2',
	HEADING3: 'HEADING3',
	HEADING4: 'HEADING4',
	HEADING5: 'HEADING5',
	HEADING6: 'HEADING6',
} as const;

export const GlyphType = {
	BULLET: 'BULLET',
	HOLLOW_BULLET: 'HOLLOW_BULLET',
	SQUARE_BULLET: 'SQUARE_BULLET',
	NUMBER: 'NUMBER',
	LATIN_UPPER: 'LATIN_UPPER',
	LATIN_LOWER: 'LATIN_LOWER',
	ROMAN_UPPER: 'ROMAN_UPPER',
	ROMAN_LOWER: 'ROMAN_LOWER',
} as const;

type Heading = (typeof ParagraphHeading)[keyof typeof ParagraphHeading];
type Glyph = (typeof GlyphType)[keyof typeof GlyphType];

export interface FakeElement {
	getType(): string;
	getParent(): FakeElement | null;
	getText?(): string;
}

interface Mutable {
	parent: FakeElement | null;
}

/**
 * The Text run inside a paragraph. Real cursors point at one of these rather
 * than at the paragraph, which is why `topLevelChildIndex` has to walk up.
 */
export interface FakeText extends FakeElement {
	getText(): string;
}

export interface FakeParagraph extends FakeElement {
	asParagraph(): FakeParagraph;
	getHeading(): Heading;
	getText(): string;
	/** The Text run a cursor would be placed in. */
	text: FakeText;
}

export interface FakeListItem extends FakeElement {
	asListItem(): FakeListItem;
	getText(): string;
	getGlyphType(): Glyph;
	getNestingLevel(): number;
	getListId(): string;
	text: FakeText;
}

export interface FakeBody extends FakeElement {
	getNumChildren(): number;
	getChild(index: number): FakeElement;
	getChildIndex(child: FakeElement): number;
}

function makeTextRun(owner: () => FakeElement, read: () => string): FakeText {
	return {
		getType: () => ElementType.TEXT,
		getParent: () => owner(),
		getText: read,
	};
}

/** A paragraph, optionally carrying a named style. */
export function paragraph(
	content: string,
	heading: Heading = ParagraphHeading.NORMAL,
): FakeParagraph {
	const state: Mutable = { parent: null };
	const self = {
		getType: () => ElementType.PARAGRAPH,
		getParent: () => state.parent,
		asParagraph: () => self,
		getHeading: () => heading,
		getText: () => content,
	} as FakeParagraph;
	self.text = makeTextRun(
		() => self,
		() => content,
	);
	// biome-ignore lint/suspicious/noExplicitAny: attach the mutable slot
	(self as any).__state = state;
	return self;
}

/** A list item. `listId` groups items Docs considers one list. */
export function listItem(
	content: string,
	options: {
		glyph?: Glyph;
		level?: number;
		listId?: string;
	} = {},
): FakeListItem {
	const glyph = options.glyph ?? GlyphType.BULLET;
	const level = options.level ?? 0;
	const listId = options.listId ?? 'list-1';
	const state: Mutable = { parent: null };
	const self = {
		getType: () => ElementType.LIST_ITEM,
		getParent: () => state.parent,
		asListItem: () => self,
		getText: () => content,
		getGlyphType: () => glyph,
		getNestingLevel: () => level,
		getListId: () => listId,
	} as FakeListItem;
	self.text = makeTextRun(
		() => self,
		() => content,
	);
	// biome-ignore lint/suspicious/noExplicitAny: attach the mutable slot
	(self as any).__state = state;
	return self;
}

/** A non-text child, to check that it is skipped rather than serialized. */
export function table(): FakeElement {
	const state: Mutable = { parent: null };
	const self = {
		getType: () => ElementType.TABLE,
		getParent: () => state.parent,
	} as FakeElement;
	// biome-ignore lint/suspicious/noExplicitAny: attach the mutable slot
	(self as any).__state = state;
	return self;
}

/** Assembles children into a body and wires up their parent links. */
export function body(children: FakeElement[]): FakeBody {
	const self = {
		getType: () => ElementType.BODY_SECTION,
		getParent: () => null,
		getNumChildren: () => children.length,
		getChild: (index: number) => children[index],
		getChildIndex: (child: FakeElement) => {
			const index = children.indexOf(child);
			if (index === -1)
				throw new Error('element is not a child of this body');
			return index;
		},
	} as FakeBody;
	for (const child of children) {
		// biome-ignore lint/suspicious/noExplicitAny: read back the mutable slot
		const state = (child as any).__state as Mutable | undefined;
		if (state) state.parent = self;
	}
	return self;
}

/** A cursor, as `Document.getCursor()` returns it. */
export function cursor(element: FakeElement, offset: number) {
	return {
		getElement: () => element,
		getOffset: () => offset,
	};
}

/**
 * One element of a selection. A partial range covers part of an element's text;
 * a non-partial range covers the whole element.
 */
export function rangeElement(
	element: FakeElement,
	range?: { start: number; endInclusive: number },
) {
	return {
		getElement: () => element,
		isPartial: () => range !== undefined,
		getStartOffset: () => range?.start ?? -1,
		getEndOffsetInclusive: () => range?.endInclusive ?? -1,
	};
}

/** A selection, as `Document.getSelection()` returns it. */
export function selection(elements: ReturnType<typeof rangeElement>[]) {
	return { getRangeElements: () => elements };
}

export interface DocContext {
	beforeCursor: string;
	selectedText: string;
	afterCursor: string;
}

/** The subset of Code.gs the tests drive. */
export interface AddonScript {
	bodyToMarkdown(body: FakeBody): string;
	serializeBody(body: FakeBody): {
		markdown: string;
		blocks: Array<{
			start: number;
			prefixLength: number;
			textLength: number;
		} | null>;
	};
	getDocContext(): DocContext;
	headingPrefix(heading: Heading): string;
	setActiveDocument(document: {
		getBody(): FakeBody;
		getSelection(): unknown;
		getCursor(): unknown;
	}): void;
}

/**
 * Evaluates `Code.gs` against a stubbed `DocumentApp` and returns the functions
 * under test. Read once, re-evaluated per call so tests never share state.
 */
export function loadAddonScript(): AddonScript {
	const source = readFileSync(CODE_GS, 'utf8');

	let activeDocument: unknown = null;
	const DocumentApp = {
		ElementType,
		ParagraphHeading,
		GlyphType,
		getActiveDocument: () => activeDocument,
	};

	// Evaluating the source is the whole point: it is what makes these tests
	// cover the file that actually ships to Apps Script rather than a duplicate
	// of it. The input is a repo file read from disk at a fixed path, never user
	// or network data, so the usual injection concern behind this rule does not
	// apply. `DocumentApp` is passed as a parameter rather than left global so
	// the stub cannot leak into other tests in the same worker.
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	const factory = new Function(
		'DocumentApp',
		`${source}
		return {
			bodyToMarkdown: bodyToMarkdown,
			serializeBody: serializeBody,
			getDocContext: getDocContext,
			headingPrefix: headingPrefix,
		};`,
	);

	// eslint-disable-next-line @typescript-eslint/no-unsafe-call
	const exported = factory(DocumentApp) as Omit<
		AddonScript,
		'setActiveDocument'
	>;

	return {
		...exported,
		setActiveDocument(document) {
			activeDocument = document;
		},
	};
}

/** A document with no cursor and no selection. */
export function documentWith(
	docBody: FakeBody,
	options: { cursor?: unknown; selection?: unknown } = {},
) {
	return {
		getBody: () => docBody,
		getSelection: () => options.selection ?? null,
		getCursor: () => options.cursor ?? null,
	};
}
