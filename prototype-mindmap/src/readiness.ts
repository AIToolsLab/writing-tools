/**
 * Readiness signal — should the AI attempt a mirror for a candidate yet?
 *
 * This is the hinge of the "build as you go" experience. Mirror too early and
 * the AI imposes structure the user has not thought through; mirror too late and
 * the product becomes a grueling Q&A. The default bias is conservative: when in
 * doubt, ask a clarifying question rather than mirror.
 *
 * Three conditions, all required:
 *   1. sourceDensity   — repeated, weighted user grounding (spontaneous > prompted)
 *   2. relationClarity — the user has language for a relationship, not just a topic
 *   3. unsupportedRisk — a cheap prediction that the validator will accept it
 *
 * Plus a hard rule: a hierarchy needs at least one *spontaneous* containment
 * signal before it can ever be mirrored.
 */

import type { MindmapConfig } from "./config";
import { contentTokens, stem, stemSet } from "./normalize";
import type {
  CandidateThought,
  ReadinessSignal,
  SourceUtterance,
} from "./types";

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Repeated, weighted grounding. More distinct evidence utterances raise density;
 * spontaneous relational signals count more than prompted ones. Normalized so a
 * candidate with a couple of distinct evidence turns plus some spontaneous
 * relational language clears a 0.7 bar.
 */
function computeSourceDensity(
  candidate: CandidateThought,
  cfg: MindmapConfig,
): number {
  const distinctEvidence = new Set(candidate.evidenceUtteranceIds).size;
  // Two distinct evidence turns is the baseline for "repeated".
  const evidenceScore = clamp01(distinctEvidence / 2);

  // A pure "idea" has no relationship by design, so it must not be scored on a
  // relational dimension it can never satisfy — repeated evidence alone carries it.
  if (candidate.target === "idea") {
    return evidenceScore;
  }

  const relationScore = candidate.relationSignals.reduce(
    (sum, s) =>
      sum +
      (s.spontaneous
        ? cfg.readiness.spontaneousWeight
        : cfg.readiness.promptedWeight),
    0,
  );
  // One spontaneous signal (weight 1.0) already meaningfully contributes.
  const relationComponent = clamp01(relationScore / 1.0);

  // For relational targets, evidence repetition and relational weight reinforce.
  return clamp01(0.5 * evidenceScore + 0.5 * relationComponent);
}

/**
 * Relational clarity. Pure "idea" candidates only need evidence (no relation
 * required). Hierarchy/connection candidates need actual relational language.
 */
function computeRelationClarity(candidate: CandidateThought): number {
  if (candidate.target === "idea") {
    return candidate.evidenceUtteranceIds.length > 0 ? 1 : 0;
  }
  if (candidate.relationSignals.length === 0) return 0;
  const spontaneousCount = candidate.relationSignals.filter(
    (s) => s.spontaneous,
  ).length;
  // Any relational language gives partial clarity; spontaneous pushes it high.
  return clamp01(0.5 + 0.5 * clamp01(spontaneousCount));
}

/**
 * Cheap pre-prediction of validator rejection risk: how much of the candidate's
 * gathered evidence vocabulary is *not* in the Source Bank stems. (The gist is
 * the AI's paraphrase; if it already drifts from user words, the real validator
 * will likely reject the mirror.) This is a heuristic, not the validator itself.
 */
function computeUnsupportedRisk(
  candidate: CandidateThought,
  bank: SourceUtterance[],
): number {
  const bankStems = stemSet(bank.map((u) => u.text));
  const gistContent = contentTokens(candidate.gist);
  if (gistContent.length === 0) return 1; // nothing to ground => max risk
  const unsupported = gistContent.filter((tok) => !bankStems.has(stem(tok)));
  return clamp01(unsupported.length / gistContent.length);
}

export function evaluateReadiness(
  candidate: CandidateThought,
  bank: SourceUtterance[],
  cfg: MindmapConfig,
  acceleratedIdeaIds: ReadonlySet<string> = new Set(),
): ReadinessSignal {
  const sourceDensity = computeSourceDensity(candidate, cfg);
  const relationClarity = computeRelationClarity(candidate);
  const unsupportedRisk = computeUnsupportedRisk(candidate, bank);

  const r = cfg.readiness;

  // Hard rule: hierarchies require a spontaneous containment signal.
  const hasSpontaneous = candidate.relationSignals.some((s) => s.spontaneous);
  const spontaneousRuleViolated =
    candidate.target === "hierarchy" &&
    r.requireSpontaneousForHierarchy &&
    !hasSpontaneous;

  const densityAccelerated =
    candidate.target === "idea" && acceleratedIdeaIds.has(candidate.id);
  const densityOk = densityAccelerated || sourceDensity >= r.sourceDensityMin;
  const clarityOk = relationClarity >= r.relationClarityMin;
  const riskOk = unsupportedRisk <= r.unsupportedRiskMax;

  const ready = densityOk && clarityOk && riskOk && !spontaneousRuleViolated;

  let reason = "Ready to mirror.";
  if (!ready) {
    if (spontaneousRuleViolated)
      reason = "Hierarchy needs containment language the user offers unprompted.";
    else if (!densityOk) reason = "Not enough repeated user grounding yet.";
    else if (!clarityOk) reason = "User has named a topic but not a relationship.";
    else if (!riskOk) reason = "Reflection would likely import non-user words.";
  }

  return {
    candidateId: candidate.id,
    target: candidate.target,
    sourceDensity,
    relationClarity,
    unsupportedRisk,
    decision: ready ? "attempt_mirror" : "ask_clarifying_question",
    reason: densityAccelerated && ready ? "Ready to mirror via carry-forward intent." : reason,
  };
}

/**
 * Batch helper for pacing: which candidates are ready right now. The caller
 * applies pacing (minReadyCandidatesToBatch, turns-since-last-mirror) on top.
 */
export function readyCandidates(
  candidates: CandidateThought[],
  bank: SourceUtterance[],
  cfg: MindmapConfig,
  acceleratedIdeaIds: ReadonlySet<string> = new Set(),
): ReadinessSignal[] {
  return candidates
    .map((c) => evaluateReadiness(c, bank, cfg, acceleratedIdeaIds))
    .filter((s) => s.decision === "attempt_mirror");
}
