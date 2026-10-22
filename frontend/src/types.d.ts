declare module '*.css';

declare module '*.png' {
	const value: string;
	export default value;
}

interface ChatMessage {
	role: string;
	content: string;
}

interface GenerationResult {
	generation_type: string;
	result: string;
	extra_data: Record<string, any>;
}

interface SavedItem {
	document: DocContext;
	generation: GenerationResult;
	dateSaved: Date;
}

/**
 * A document edit the AI proposes through the "My Words" tools. The harness
 * validates the inserted text against the writer's corpus before applying.
 */
type DocEdit =
	| {
			type: 'str_replace';
			oldStr: string;
			newStr: string;
			/**
			 * Optional 1-based paragraph number (from `view`) to scope the search
			 * to. Far less fragile than searching the whole body — it disambiguates
			 * repeated text and dodges the host search-length limit. If oldStr isn't
			 * in that paragraph (e.g. numbers shifted), the edit fails loudly.
			 */
			paragraph?: number;
	  }
	| {
			type: 'insert';
			text: string;
			/** Insert right after this existing text (within a paragraph). */
			after?: string;
			/**
			 * 1-based paragraph number (as shown by the `view` tool) to position a
			 * new paragraph relative to. More robust than `after` for placement.
			 */
			paragraph?: number;
			/** Where to insert relative to `paragraph`. Defaults to 'after'. */
			position?: 'before' | 'after';
	  }
	| {
			/**
			 * Remove a whole paragraph, mark included. Internal — used to apply
			 * paragraph-range splices (e.g. undoing an insert); never exposed as
			 * an agent tool.
			 */
			type: 'delete_paragraph';
			/** 1-based paragraph number (from `view`). */
			paragraph: number;
	  };

/**
 * The canonical paragraph-range mutation every `EditOp` lowers to: replace
 * `remove.length` paragraphs at `index` with `insert`. See
 * `pages/my-words/interaction/ops.ts` for lowering/inversion.
 */
interface ParagraphSplice {
	/** First affected paragraph (0-based). */
	index: number;
	/** Current text of the paragraphs replaced — doubles as a freshness check. */
	remove: string[];
	/** Paragraph texts that take their place. */
	insert: string[];
}

interface EditorAPI {
	getDocContext(this: void): Promise<DocContext>;
	addSelectionChangeHandler: (handler: () => void) => void;
	removeSelectionChangeHandler: (handler: () => void) => void;
	selectPhrase: (text: string) => Promise<void>;
	/** Full document text. Host-agnostic accessor for the corpus + `view` tool. */
	getDocText(this: void): Promise<string>;
	/**
	 * Document split into paragraphs, in order. This is the shared coordinate
	 * system the `view` tool numbers and paragraph-targeted inserts index into.
	 */
	getParagraphs(this: void): Promise<string[]>;
	/** Apply a validated edit to the document. */
	applyEdit(this: void, edit: DocEdit): Promise<void>;
	/**
	 * Apply a paragraph-range splice natively, in one atomic step (one undo
	 * entry, cursor preserved). Hosts without it get splices expressed as a
	 * sequence of `applyEdit` primitives instead.
	 */
	applySplice?(this: void, splice: ParagraphSplice): Promise<void>;
	/**
	 * Reads a value stored *with the document*, not with the user or the
	 * browser: it survives a reload, and it follows the file to whoever opens
	 * it next. Resolves to null when the key has never been written.
	 */
	getDocumentSetting: (key: string) => Promise<string | null>;
	/** Writes a value into the document. See {@link getDocumentSetting}. */
	setDocumentSetting: (key: string, value: string) => Promise<void>;
}

interface ReflectionResponseItem {
	reflection: string;
}

interface ReflectionResponses {
	reflections: ReflectionResponseItem[];
}

interface CardData {
	paragraphIndex: number;
	body: string;
}

interface ContextSection {
	title: string;
	content: string;
}

interface DocContext {
	contextData?: ContextSection[];
	/** Human-readable source label carried with launcher document snapshots. */
	documentLabel?: string;
	beforeCursor: string;
	selectedText: string;
	afterCursor: string;
}
