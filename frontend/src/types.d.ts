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
	/**
	 * Open a URL in the user's external browser. Surface-specific: Word uses
	 * Office.context.ui.openBrowserWindow; standalone/Google Docs use window.open.
	 * Used to open the Better Auth device-flow approval page.
	 */
	openExternal(url: string): void;
	getDocContext(this: void): Promise<DocContext>;
	addSelectionChangeHandler: (handler: () => void) => void;
	removeSelectionChangeHandler: (handler: () => void) => void;
	selectPhrase: (text: string) => Promise<void>;
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
