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
	getDocContext(positionalSensitivity: boolean): Promise<string>;
	getCursorPosInfo(): Promise<{charsToCursor: number, docLength: number}>;
	addSelectionChangeHandler: (handler: () => void) => void;
	removeSelectionChangeHandler: (handler: () => void) => void;
}
