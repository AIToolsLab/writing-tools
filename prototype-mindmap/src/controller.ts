/**
 * Stage 1 controller public surface. Language routing and pending command state
 * were removed; orchestration now consumes the typed assistant union directly.
 */
export { createConversationState, cloneConversationState, mergeConversationBank, processTurn } from "./stage1-loop";
export type { ProcessTurnOptions } from "./stage1-loop";
export type { ConversationState, DiagnosticEvent, TurnResult } from "./assistant-response";
