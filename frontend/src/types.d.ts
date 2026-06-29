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
	| { type: 'str_replace'; oldStr: string; newStr: string }
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
	  };

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
	beforeCursor: string;
	selectedText: string;
	afterCursor: string;
}
