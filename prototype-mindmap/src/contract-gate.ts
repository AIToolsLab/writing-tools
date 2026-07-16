/**
 * Assistance-contract response gate (Stage 2, Phase 1).
 *
 * Runs on every LLM turn before the controller commits it. It classifies the
 * turn against the session's active contract and normalizes `kind`/`attribution`
 * to contract-legal values, recording any rejection for the event ledger and the
 * Control Room. This is the code-enforceable L0 boundary: an `inferred` turn (or a
 * kind the contract does not allow) can never pass through as-is.
 *
 * The gate does NOT rewrite the model's prose — a suggestion smuggled into a
 * question's wording is not caught here (that is deferred to Stage 4 evals). What
 * it enforces is the STRUCTURAL classification the rest of the pipeline keys off,
 * and — together with the floor (validateMirror + map-write gating) and the
 * Phase 3 provenance policy — which material may reach the map.
 */

import type { Attribution, Contract, ResponseKind } from "./contracts";
import type { LLMTurn } from "./llm-contract";
import { normalize } from "./normalize";

export type GateRejectionReason =
  | "kind_not_allowed"
  | "attribution_not_allowed"
  | "options_not_verbatim"
  | "ai_originated_material_forbidden";

/** Minimal source-material shape the gate needs for the verbatim check. */
export interface GateBankEntry {
  text: string;
}

export interface GateRejection {
  reason: GateRejectionReason;
  detail: string;
  /** What the model originally emitted, before normalization. */
  original: { kind: ResponseKind; attribution: Attribution };
}

export interface GateResult {
  /** The turn with `kind`/`attribution` normalized to contract-legal values. */
  turn: LLMTurn;
  rejections: GateRejection[];
}

/** The kind a turn falls back to when its own kind is not allowed. */
function fallbackKind(turn: LLMTurn, contract: Contract): ResponseKind {
  if (turn.mode === "mirror" && contract.allowedKinds.includes("reflection")) {
    return "reflection";
  }
  // "question" is allowed at every defined contract level.
  return contract.allowedKinds.includes("question") ? "question" : contract.allowedKinds[0];
}

/** True when `phrase` appears verbatim (punctuation/case/space-insensitive) in any bank entry. */
function isVerbatimSpan(phrase: string, bank: readonly GateBankEntry[]): boolean {
  const needle = normalize(phrase);
  if (!needle) return false;
  return bank.some((entry) => normalize(entry.text).includes(needle));
}

/**
 * Classify a turn against the active contract. Pure: it returns a new turn and a
 * list of rejections; it never mutates its input. `bank` is required only for the
 * Level 1 verbatim-options check; omit it when there is no options payload.
 */
export function gateTurn(
  turn: LLMTurn,
  contract: Contract,
  bank: readonly GateBankEntry[] = [],
): GateResult {
  const rejections: GateRejection[] = [];

  const originalKind: ResponseKind =
    turn.kind ?? (turn.mode === "mirror" ? "reflection" : "question");
  const originalAttribution: Attribution = turn.attribution ?? "asserted";

  let kind = originalKind;
  let attribution = originalAttribution;
  let options = turn.options;

  // Grounded-options verbatim check. Drop any option that is not a verbatim span
  // of the user's own material; if that empties the list, the options turn has no
  // legal content and is downgraded to a question below.
  if (kind === "options" && contract.optionsMustBeVerbatim && options && options.length > 0) {
    const kept = options.filter((opt) => isVerbatimSpan(opt.text, bank));
    if (kept.length !== options.length) {
      rejections.push({
        reason: "options_not_verbatim",
        detail: `${options.length - kept.length} option(s) were not verbatim spans of user material and were dropped by contract ${contract.id}`,
        original: { kind: originalKind, attribution: originalAttribution },
      });
    }
    options = kept;
  }

  if (!contract.allowedKinds.includes(kind) || (kind === "options" && (!options || options.length === 0))) {
    const fallback = fallbackKind(turn, contract);
    rejections.push({
      reason: "kind_not_allowed",
      detail: `kind "${kind}" is not allowed by contract ${contract.id}${
        kind === "options" ? " (no verbatim options survived)" : ""
      }; downgraded to "${fallback}"`,
      original: { kind: originalKind, attribution: originalAttribution },
    });
    kind = fallback;
    options = undefined;
  }

  if (!contract.allowedAttribution.includes(attribution)) {
    rejections.push({
      reason: "attribution_not_allowed",
      detail: `attribution "${attribution}" is not allowed by contract ${contract.id}; forced to "asserted"`,
      original: { kind: originalKind, attribution: originalAttribution },
    });
    attribution = "asserted";
  }

  // The AI-originated lane exists only where the contract's provenance policy
  // permits it (Level 2). Everywhere else, strip any proposed AI card so no
  // AI-inferred material can ever reach the map. This is the code check behind the
  // falsifiable L0 claim.
  let suggestedCard = turn.suggestedCard;
  if (suggestedCard && contract.provenancePolicy !== "ai_attributed_allowed") {
    rejections.push({
      reason: "ai_originated_material_forbidden",
      detail: `contract ${contract.id} keeps the map user-authored-only; the AI-proposed card was stripped`,
      original: { kind: originalKind, attribution: originalAttribution },
    });
    suggestedCard = undefined;
  }

  return { turn: { ...turn, kind, attribution, options, suggestedCard }, rejections };
}
