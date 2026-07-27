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

interface EditorAPI {
	getDocContext(this: void): Promise<DocContext>;
	addSelectionChangeHandler: (handler: () => void) => void;
	removeSelectionChangeHandler: (handler: () => void) => void;
	selectPhrase: (text: string) => Promise<void>;
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
	beforeCursor: string;
	selectedText: string;
	afterCursor: string;
}
