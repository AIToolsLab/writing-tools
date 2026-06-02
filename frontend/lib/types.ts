// Shared domain types for the writing assistant. (Commit 4 ports the remaining
// editor/UI types; the API layer only needs these.)

export interface ContextSection {
	title: string;
	content: string;
}

export interface DocContext {
	contextData?: ContextSection[];
	beforeCursor: string;
	selectedText: string;
	afterCursor: string;
}

export interface GenerationResult {
	generation_type: string;
	result: string;
	extra_data: Record<string, unknown>;
}

export interface ChatMessage {
	role: string;
	content: string;
}

export interface SavedItem {
	document: DocContext;
	generation: GenerationResult;
	dateSaved: Date;
}

// Platform abstraction implemented per surface (Word / standalone / — later — Google
// Docs). Auth0's doLogin/doLogout were removed in the Next migration; authentication
// re-enters later through a separate session seam, not the editor API.
export interface EditorAPI {
	getDocContext(this: void): Promise<DocContext>;
	addSelectionChangeHandler: (handler: () => void) => void;
	removeSelectionChangeHandler: (handler: () => void) => void;
	selectPhrase: (text: string) => Promise<void>;
}
