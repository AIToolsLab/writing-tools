export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export interface TextEditorState {
  beforeCursor: string;
  selectedText: string;
  afterCursor: string;
}

export interface ConversationMessage {
  role: 'user' | 'colleague';
  content: string;
}

export interface WritingSupportRequest {
  editorState: TextEditorState;
  context?: string;
  conversationHistory?: ConversationMessage[];
  conversationHistoryMode?: 'direct' | 'nudge';
}

export interface WritingSupportResponse {
  suggestions: string[];
}

export type GenerationType = 'example_sentences' | 'analysis_readerPerspective' | 'proposal_advice';

export interface GenerationResult {
  result: string;
  generation_type: GenerationType;
}

export interface SavedItem {
  generation: GenerationResult;
  document: TextEditorState;
  dateSaved: Date;
}
