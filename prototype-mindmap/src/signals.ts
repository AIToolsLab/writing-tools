/**
 * Structural-signal detection.
 *
 * Question Mode fills the Candidate Thought Store by listening for two kinds of
 * language in the user's turns:
 *   - containment language  ("inside", "part of", "belongs to")  -> hierarchy
 *   - relation language     ("because", "leads to", "depends on") -> connection
 *
 * Each detected signal is flagged spontaneous or prompted. A signal is
 * *prompted* when the same relational word appeared in the AI's immediately
 * preceding question — i.e. the AI handed the user that framing. It is
 * *spontaneous* when the user supplied it unprompted. Spontaneous signals are
 * stronger evidence that the structure is genuinely in the user's head, so the
 * readiness signal weights them more heavily.
 *
 * Detection is deterministic keyword matching — a prototype stub, not NLP.
 */

import { normalize } from "./normalize";
import type { RelationSignal } from "./types";

export const CONTAINMENT_TERMS = [
  "inside",
  "within",
  "part of",
  "belongs to",
  "belong to",
  "under",
  "underneath",
  "branch of",
  "branches",
  "sub",
  "contains",
  "contain",
  "made up of",
  "consists of",
  "bigger",
  "broader",
  "umbrella",
];

export const RELATION_TERMS = [
  "because",
  "leads to",
  "lead to",
  "depends on",
  "depend on",
  "causes",
  "cause",
  "results in",
  "connected to",
  "connects",
  "connect",
  "related to",
  "relates to",
  "same as",
  "different from",
  "in tension with",
  "tension between",
  "versus",
  "opposed to",
  "supports",
  "drives",
];

export type SignalKind = "containment" | "relation";

export interface DetectedSignal extends RelationSignal {
  kind: SignalKind;
  term: string;
}

function findTerms(haystack: string, terms: string[]): string[] {
  // Pad with spaces so we match whole words/phrases, not substrings of words
  // (avoids "under" matching "thunder").
  const padded = ` ${haystack} `;
  return terms.filter((term) => padded.includes(` ${term} `));
}

/**
 * Detect containment/relation signals in a user utterance. `priorAiQuestion`
 * (the AI's immediately preceding turn, if any) determines spontaneity: a term
 * the AI already used is prompted; everything else is spontaneous.
 */
export function detectSignals(
  utteranceId: string,
  userText: string,
  priorAiQuestion?: string,
): DetectedSignal[] {
  const userNorm = normalize(userText);
  const priorNorm = priorAiQuestion ? normalize(priorAiQuestion) : "";

  const containment = findTerms(userNorm, CONTAINMENT_TERMS).map(
    (term): DetectedSignal => ({
      kind: "containment",
      term,
      phrase: term,
      utteranceId,
      spontaneous: !(priorNorm && ` ${priorNorm} `.includes(` ${term} `)),
    }),
  );

  const relation = findTerms(userNorm, RELATION_TERMS).map(
    (term): DetectedSignal => ({
      kind: "relation",
      term,
      phrase: term,
      utteranceId,
      spontaneous: !(priorNorm && ` ${priorNorm} `.includes(` ${term} `)),
    }),
  );

  return [...containment, ...relation];
}

/** Which candidate target a set of signals implies. */
export function targetForSignals(
  signals: DetectedSignal[],
): "idea" | "hierarchy" | "connection" {
  if (signals.some((s) => s.kind === "containment")) return "hierarchy";
  if (signals.some((s) => s.kind === "relation")) return "connection";
  return "idea";
}
