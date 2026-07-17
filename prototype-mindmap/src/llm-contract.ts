import type { OpenThreadContext } from "./open-threads";
import type { TurnShape } from "./turn-shape";
import type { CandidateThought, SourceUtterance, ThoughtUnit, ThoughtUnitRole } from "./types";
import type { AssistanceContractSnapshot } from "./assistance-contract";

export type QuestionStance = "settle" | "narrow" | "deepen" | "organize" | "challenge";
export type UserRequestedMode = "mirror" | "deepen" | "organize" | "pivot";
export interface ProposalOutcomeContext {
  proposalKind: "map_action" | "reflection";
  decision: "confirmed" | "declined";
}

export interface LLMMapConnection {
  id: string;
  sourceId: string;
  targetId: string;
  labelUnitId: string;
  labelText: string;
  sourceText: string;
  targetText: string;
  utteranceIds: string[];
}

export interface LLMMapContext { thoughtUnits: ThoughtUnit[]; connections: LLMMapConnection[] }
export interface MapQuestionAnchor { ref: string; text: string; neighbors: Array<{ ref: string; text: string }> }
export interface SelectedFocusContext {
  cards?: Array<{ id: string; ref: string; text: string; role: Exclude<ThoughtUnitRole, "connection_label"> }>;
  draftText?: string;
}

/** Read-only context for a typed assistant response. Every calibration field is advisory. */
export interface LLMContext {
  bank: SourceUtterance[];
  candidates: CandidateThought[];
  turnShape: TurnShape;
  /** Product capability facts, not an interpretation of the user's intent. */
  capabilities: { canDo: string[]; cantDo: string[] };
  openThreads?: OpenThreadContext[];
  /** A structural map fact that may inform pacing but never constrains a response. */
  mapPacing: { cardCount: number; connectionCount: number; isSparse: boolean };
  /** Factual conversation rhythm; advisory only and never a response gate. */
  reflectionRhythm: { turnsSinceLastReflection: number; sourceUtteranceCount: number };
  /** Exact value of the explicit user-facing Think/Map control. */
  thinkMapBias: number;
  draft?: string;
  map: LLMMapContext;
  /** Explicit UI selection, if the user made one. */
  selectedFocus?: SelectedFocusContext;
  /** Explicit UI support request, advisory only. */
  requestedSupport?: UserRequestedMode;
  /** A user decision on an earlier proposal. It is not new source material. */
  proposalOutcome?: ProposalOutcomeContext;
  /** A fixed per-turn contribution contract. It never authorizes a map write. */
  assistanceContract?: AssistanceContractSnapshot;
}
