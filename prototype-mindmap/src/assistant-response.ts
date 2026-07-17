import type { LLMContext, QuestionStance } from "./llm-contract";
import type { CandidateStore, SourceBank } from "./store";
import type { ProposedAction } from "./action-gateway";
import type { MirrorReflection } from "./types";
import type { Proposal } from "./proposal-store";
import type { ParkedThread } from "./open-threads";
import type { SourceBackedOption } from "./assistance-contract";

export type AssistantResponse =
  | { kind: "question"; text: string; stance?: QuestionStance; anchor?: string }
  | { kind: "reflection"; text: string; reflection: MirrorReflection }
  | { kind: "aside"; text: string }
  | { kind: "map_proposal"; text: string; action: ProposedAction }
  | { kind: "options"; text: string; options: SourceBackedOption[] }
  | { kind: "suggestion"; text: string };

export interface AssistantAdvisory {
  candidateUpserts?: Array<{
    id: string;
    target: "idea" | "hierarchy" | "connection";
    gist: string;
    addEvidenceIds: string[];
  }>;
  candidateDeletes?: string[];
  affect?: "exhausted" | "frustrated" | "overwhelmed" | "energized";
}

/** The provider returns this union directly; there is no language-routing adapter. */
export interface AssistantResponseEnvelope {
  response: AssistantResponse;
  advisory?: AssistantAdvisory;
}

export interface ConversationState {
  bank: SourceBank;
  candidates: CandidateStore;
  draft: string;
  turnsSinceLastReflection: number;
  lastAssistantText: string;
  dismissedCandidateIds: string[];
  openThreads: ParkedThread[];
}

export type DiagnosticStage = "response" | "validation" | "gateway" | "repair" | "proposal" | "application";
export type DiagnosticOutcome = "accepted" | "needs_input" | "rejected" | "repaired" | "applied";

export interface DiagnosticEvent {
  id: string;
  at: number;
  stage: DiagnosticStage;
  outcome: DiagnosticOutcome;
  code: string;
  detail: string;
}

export interface StructuredRejection {
  code: string;
  detail: string;
  fields?: string[];
}

/** A provider answered successfully, but its model output could not enter the typed union. */
export class ModelResponseValidationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ModelResponseValidationError";
  }
}

export type AssistantModel = (
  context: LLMContext,
  repair?: StructuredRejection,
) => Promise<AssistantResponseEnvelope>;

export interface TurnResult {
  response?: AssistantResponse;
  proposal?: Proposal;
  diagnostics: DiagnosticEvent[];
}
