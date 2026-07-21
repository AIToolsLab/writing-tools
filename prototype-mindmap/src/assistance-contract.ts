import type { SourceSpan } from "./types";

export type AssistanceLevel = 0 | 1 | 2;
export type AssistantResponseKind = "question" | "reflection" | "grounded_recap" | "aside" | "map_proposal" | "options" | "suggestion";
export type ContributionOrigin = "user_asserted" | "ai_connected" | "ai_suggested" | "unresolved" | "legacy_confirmed";

export interface AssistanceContract {
  id: "non_directive_v1" | "grounded_options_v1" | "suggestive_v1";
  version: 1;
  level: AssistanceLevel;
  label: string;
  description: string;
  allowedResponseKinds: readonly AssistantResponseKind[];
  allowsAiSuggestedStructure: boolean;
  optionsMustBeVerbatim: boolean;
  mapWritePolicy: "user_confirmation_required";
  visualStagingPolicy: "no_unconfirmed_structure";
}

export type AssistanceContractSnapshot = Pick<AssistanceContract,
  "id" | "version" | "level" | "label" | "allowedResponseKinds" | "allowsAiSuggestedStructure" | "optionsMustBeVerbatim" | "mapWritePolicy" | "visualStagingPolicy">;

export const ASSISTANCE_CONTRACTS: Record<AssistanceLevel, AssistanceContract> = {
  0: {
    id: "non_directive_v1", version: 1, level: 0, label: "Non-directive",
    description: "I ask and reflect your stated ideas.",
    allowedResponseKinds: ["question", "reflection", "grounded_recap", "aside", "map_proposal"],
    allowsAiSuggestedStructure: false, optionsMustBeVerbatim: false,
    mapWritePolicy: "user_confirmation_required", visualStagingPolicy: "no_unconfirmed_structure",
  },
  1: {
    id: "grounded_options_v1", version: 1, level: 1, label: "Grounded options",
    description: "I can offer choices using your words.",
    allowedResponseKinds: ["question", "reflection", "grounded_recap", "aside", "map_proposal", "options"],
    allowsAiSuggestedStructure: false, optionsMustBeVerbatim: true,
    mapWritePolicy: "user_confirmation_required", visualStagingPolicy: "no_unconfirmed_structure",
  },
  2: {
    id: "suggestive_v1", version: 1, level: 2, label: "Suggestive",
    description: "I can introduce ideas, marked as AI suggestions.",
    allowedResponseKinds: ["question", "reflection", "grounded_recap", "aside", "map_proposal", "options", "suggestion"],
    allowsAiSuggestedStructure: true, optionsMustBeVerbatim: true,
    mapWritePolicy: "user_confirmation_required", visualStagingPolicy: "no_unconfirmed_structure",
  },
};

export const DEFAULT_ASSISTANCE_CONTRACT = ASSISTANCE_CONTRACTS[0];

export function contractForLevel(level: AssistanceLevel): AssistanceContract { return ASSISTANCE_CONTRACTS[level]; }
export function snapshotContract(contract: AssistanceContract): AssistanceContractSnapshot {
  const { id, version, level, label, allowedResponseKinds, allowsAiSuggestedStructure, optionsMustBeVerbatim, mapWritePolicy, visualStagingPolicy } = contract;
  return { id, version, level, label, allowedResponseKinds, allowsAiSuggestedStructure, optionsMustBeVerbatim, mapWritePolicy, visualStagingPolicy };
}

export interface InfluenceTrace {
  priorAssistantMessageId?: number;
  exactOverlapPhrases: string[];
  /**
   * Fraction (0–1) of the proposal's distinct cited phrases that also appear
   * verbatim in the coach's immediately prior message. Surfaced on the proposal
   * card so an echo of the coach's own framing is visible in the moment, not
   * only in the ledger.
   */
  /** Present for traces created after the percentage was introduced. */
  overlapRatio?: number;
}

/**
 * Older v4 sessions predate `overlapRatio`. Do not invent a percentage from
 * incomplete history: retain the useful echo signal and let the UI omit it.
 */
export function normalizeInfluenceTrace(trace: InfluenceTrace | undefined): InfluenceTrace | undefined {
  if (!trace?.exactOverlapPhrases.length) return undefined;
  const ratio = trace.overlapRatio;
  return Number.isFinite(ratio) && ratio! >= 0 && ratio! <= 1
    ? { ...trace, overlapRatio: ratio }
    : { ...trace, overlapRatio: undefined };
}

export interface SourceBackedOption { text: string; sourceSpans: SourceSpan[]; }

