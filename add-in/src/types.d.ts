declare module '*.css';

interface ChatMessage {
	role: string;
	content: string;
}

interface SavedItem {
	document: string;
	generation: string;
	type: string;
	dateSaved: Date;
}

interface EditorAPI {
	getDocContext(positionalSensitivity: boolean): Promise<string>;
	getCursorPosInfo(): Promise<{charsToCursor: number, docLength: number}>;
	addSelectionChangeHandler: (handler: () => void) => void;
	removeSelectionChangeHandler: (handler: () => void) => void;
}
