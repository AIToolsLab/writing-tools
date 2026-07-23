import type { LLMContext, QuestionStance } from "./llm-contract";
import type { CandidateStore, SourceBank } from "./store";
import type { ProposedAction } from "./action-gateway";
import type { GroundedRecap, MirrorReflection } from "./types";
import type { Proposal } from "./proposal-store";
import type { SourceBackedOption } from "./assistance-contract";
import type { LatestUserLanguagePattern } from "./language-context";

export interface RecallAnnotation {
  candidateId: string;
  sourceUtteranceId: string;
  userPhrase: string;
}

export type AssistantResponse =
  | { kind: "question"; text: string; stance?: QuestionStance; anchor?: string; recall?: RecallAnnotation }
  | { kind: "reflection"; text: string; reflection: MirrorReflection }
  | { kind: "grounded_recap"; text: string; recap: GroundedRecap }
  | { kind: "aside"; text: string; recall?: RecallAnnotation }
  | { kind: "map_proposal"; text: string; action: ProposedAction; candidateId?: string }
  | { kind: "options"; text: string; options: SourceBackedOption[] }
  | { kind: "suggestion"; text: string };

export interface AssistantAdvisory {
  candidateUpserts?: Array<{
    id: string;
    target: "idea" | "hierarchy" | "connection";
    gist: string;
    addEvidenceIds: string[];
    status: "active" | "parked";
  }>;
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
  currentDraftSnapshotId?: string;
  draftSnapshotText?: string;
  turnsSinceLastReflection: number;
  lastAssistantText: string;
  currentUserTurn: number;
  /** A coarse advisory hint retained for coach-only turns and reloads. */
  latestUserLanguagePattern: LatestUserLanguagePattern;
  legacyIgnoredCandidateIds: string[];
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
  reflectionRecovery?: ReflectionRecoveryContext;
}

export type ReflectionRecoveryStage = "informed_repair" | "forced_question";

export interface ReflectionRecoveryContext {
  stage: ReflectionRecoveryStage;
  ungroundedContentWords: string[];
  rejectedReflections: Array<Extract<AssistantResponse, { kind: "reflection" }>>;
}

export type TurnProgressStage = "initial_attempt" | "grounding_repair" | "forced_question";

export interface TurnProgressEvent {
  stage: TurnProgressStage;
  modelCall: 1 | 2 | 3;
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

/** Application-owned terminal state after the permitted bounded recovery fails. */
export interface RepairFailureTerminal {
  kind: "repair_failed";
  message: string;
}

export interface TurnResult {
  response?: AssistantResponse;
  proposal?: Proposal;
  recall?: VerifiedRecall;
  lifecycleChanges?: CandidateLifecycleChange[];
  terminal?: RepairFailureTerminal;
  diagnostics: DiagnosticEvent[];
}

export interface CandidateLifecycleChange {
  candidateId: string;
  status: "active" | "parked";
  turn: number;
  source: "model";
}

export interface VerifiedRecall extends RecallAnnotation {
  ageInTurns: number;
}
