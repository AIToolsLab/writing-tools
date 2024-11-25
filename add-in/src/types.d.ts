declare module '*.css';

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
	document: string;
	generation: GenerationResult;
	dateSaved: Date;
}

interface EditorAPI {
	doLogin(auth0Client: Auth0ContextInterface): Promise<void>;
	getDocContext(positionalSensitivity: boolean): Promise<string>;
	getCursorPosInfo(): Promise<{charsToCursor: number, docLength: number}>;
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
