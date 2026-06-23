export type ChatRole = "user" | "assistant";
export type ChatInputType = "typed" | "voice";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  timestamp: number;
  inputType?: ChatInputType;
  coachMode?: CoachMode;
}

export type WordBankStatus = "proposed" | "approved" | "rejected";
export type WordBankActor = "ai_extract" | "ai_edit" | "user";

export interface WordBankItem {
  id: string;
  text: string;
  sourceMessageIds: string[];
  status: WordBankStatus;
  createdBy: WordBankActor;
  lastEditedBy: WordBankActor;
  updatedAt: number;
}

export type GuardrailCode =
  | "OK"
  | "EMPTY_TEXT"
  | "INVALID_SOURCE"
  | "TEXT_NOT_USER_OWNED"
  | "TEXT_NOT_BANK_WORTHY"
  | "DUPLICATE_BANK_ITEM"
  | "BANK_ITEM_NOT_FOUND"
  | "BANK_ITEM_NOT_APPROVED"
  | "INSERT_TEXT_MISMATCH"
  | "INVALID_SELECTION"
  | "PLACEHOLDER_NOT_FOUND"
  | "ANCHOR_NOT_FOUND";

export interface GuardrailResult {
  ok: boolean;
  code: GuardrailCode;
  message: string;
}

export interface BankWriteRequest {
  candidateText: string;
  messages: ChatMessage[];
  existingItems: WordBankItem[];
  messageId?: string;
  currentItem?: WordBankItem;
  origin: "ai" | "user";
}

export interface BankWriteResult {
  guardrail: GuardrailResult;
  item?: WordBankItem;
}

export type InsertionTargetKind =
  | "selection"
  | "cursor"
  | "append"
  | "placeholder"
  | "before_paragraph"
  | "after_paragraph";

export interface InsertionTarget {
  kind: InsertionTargetKind;
  start?: number;
  end?: number;
  placeholder?: string;
  anchorText?: string;
}

export interface InsertionSuggestion {
  id: string;
  bankItemId: string;
  bankText: string;
  target: InsertionTarget;
  reason: string;
  status: "suggested" | "accepted" | "dismissed";
  createdAt: number;
  highlightRange?: {
    start: number;
    end: number;
  };
}

export interface DocumentInsertRequest {
  draft: string;
  bankItem: WordBankItem;
  target: InsertionTarget;
  textToInsert: string;
}

export interface DocumentInsertResult {
  guardrail: GuardrailResult;
  nextDraft?: string;
  insertedRange?: {
    start: number;
    end: number;
  };
}

export interface OwnershipValidator {
  normalize: (text: string) => string;
  validateAgainstMessages: (
    candidateText: string,
    messages: ChatMessage[],
  ) => GuardrailResult;
}

export type CoachMode = "reflection" | "writing" | "placement";

export interface CoachExtractionResponse {
  reply: string;
  coachMode: CoachMode;
  candidateTexts: string[];
  focusQuote?: string;
  placementCandidateText?: string;
}

export interface PlacementSuggestionResponse {
  target: InsertionTarget;
  reason: string;
}
