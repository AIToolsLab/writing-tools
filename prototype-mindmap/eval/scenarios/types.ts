import type { AssistanceLevel } from "../../src/assistance-contract";
import type { ConversationMessage } from "../../src/api";
import type { CandidateTarget } from "../../src/types";

export interface EvalMemoryEvent {
  afterUserTurn: number;
  action: "nominate" | "ignore" | "promote";
  candidateKey: string;
  target: CandidateTarget;
  evidenceTurn: number;
  userPhrase: string;
}

export interface EvalScenario {
  id: string;
  title: string;
  levels: readonly AssistanceLevel[];
  /** Live user turns, identical across the assistance levels being compared. */
  userTurns: string[];
  /** Fixed setup transcript for a targeted final-turn probe, if required. */
  prelude?: ConversationMessage[];
  draft?: string;
  selectedPassage?: string;
  memoryEvents?: EvalMemoryEvent[];
  smuggleNote: string;
  expectedBehavior?: string;
  recallNote?: string;
  anchorGuidance?: "avoid" | "optional" | "prefer";
}

export const EVAL_LEVELS = [0, 2] as const;
