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
	doLogin(auth0Client: Auth0ContextInterface): Promise<void>;
	doLogout(auth0Client: Auth0ContextInterface): Promise<void>;
	getDocContext(): Promise<DocContext>;
	addSelectionChangeHandler: (handler: () => void) => void;
	removeSelectionChangeHandler: (handler: () => void) => void;
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
