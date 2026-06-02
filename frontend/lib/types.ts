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
