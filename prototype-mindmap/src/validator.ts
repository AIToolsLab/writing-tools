/**
 * Mirror validator — the enforcement core.
 *
 * Before any mirror reflection can be shown to the user, it must pass three
 * checks against the Source Bank. This is *code*, not prompting: if the AI's
 * proposed reflection fails, it cannot be displayed, and the AI must fall back
 * to asking a clarifying question.
 *
 * The three checks, coarsest to finest:
 *   1. Content overlap — are the reflection's content words the user's words?
 *      (catches vocabulary drift)
 *   2. Source-span grounding — does every claim trace to a user utterance that
 *      actually supports it? (catches new *relationships* built from real words)
 *   3. Unsupported words — are stray new content words below budget?
 *      (catches small but meaning-shifting insertions like "central")
 *
 * Checks run per-claim so the caller can show/confirm chunks independently and
 * knows exactly which span to ask about when one fails.
 */

import type { MindmapConfig } from "./config";
import {
  containsWholePhrase,
  contentTokens,
  isStopword,
  normalize,
  stem,
  stemSet,
  tokenize,
} from "./normalize";
import type {
  ClaimValidation,
  MirrorCheckResult,
  MirrorClaim,
  MirrorReflection,
  MirrorValidationResult,
  SourceSpan,
  SourceUtterance,
} from "./types";

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}

/** Look up the text of cited utterances; missing ids contribute nothing. */
function citedTexts(span: SourceSpan, bank: Map<string, SourceUtterance>): string[] {
  return span.utteranceIds
    .map((id) => bank.get(id)?.text)
    .filter((t): t is string => typeof t === "string");
}

/**
 * Lexical grounding — is the reflection made of the user's words?
 *
 * One check with two parts over the same provenance signal:
 *   - broad overlap:  enough content words trace to the user (catches drift)
 *   - additions:      stray new content words stay under budget (catches a
 *                     single meaning-shifting insertion the average let through)
 *
 * The check passes only if both parts pass. They share data but apply two
 * thresholds — a blunt floor and a fine ceiling — so it stays a single concept
 * (lexical grounding) rather than implying two independent protections.
 */
function checkLexicalGrounding(
  claim: MirrorClaim,
  bankStems: Set<string>,
  overlapMin: number,
  additionsMax: number,
): MirrorCheckResult {
  const content = contentTokens(claim.text);
  const owned = content.filter((tok) => bankStems.has(stem(tok)));
  const overlap = ratio(owned.length, content.length);
  const additions = ratio(content.length - owned.length, content.length);

  const noContent = content.length === 0; // nothing reflected => fail closed
  const broadOk = !noContent && overlap >= overlapMin;
  const additionsOk = !noContent && additions <= additionsMax;

  return {
    check: "lexical_grounding",
    ok: broadOk && additionsOk,
    score: overlap,
    threshold: overlapMin,
    parts: [
      { name: "broad_overlap", ok: broadOk, score: overlap, threshold: overlapMin },
      { name: "additions", ok: additionsOk, score: additions, threshold: additionsMax },
    ],
  };
}

/**
 * Is a span's user phrase grounded within a SINGLE cited utterance (not the
 * union of several)? Relationships must have been stated in one breath, so the
 * AI can't assemble a connection by citing the two entities from separate turns.
 */
function spanGroundedInSingleUtterance(
  span: SourceSpan,
  bank: Map<string, SourceUtterance>,
  threshold: number,
): boolean {
  const phraseContent = contentTokens(span.userPhrase);
  if (phraseContent.length === 0) return false;
  for (const id of span.utteranceIds) {
    const text = bank.get(id)?.text;
    if (!text) continue;
    const uStems = stemSet([text]);
    const grounded = phraseContent.filter((tok) => uStems.has(stem(tok)));
    if (ratio(grounded.length, phraseContent.length) >= threshold) return true;
  }
  return false;
}

/**
 * Check 2 — source-span grounding.
 * Every span must (a) cite at least one real utterance and (b) have most of the
 * user-phrase's content words actually present in those utterances. A claim with
 * no spans is ungrounded by definition.
 *
 * For hierarchy/connection claims there is an additional pointer requirement:
 * the model declares the literal connective it relied on and code verifies it
 * against one source utterance.  No relation-word bank participates in this
 * enforcement path.
 */

/**
 * The relationship the CLAIM asserts must have been stated in one breath. The
 * per-span binding above is not enough on its own — the AI can stitch two
 * fully-grounded user sentences together with an invented connective
 * ("A. leads to B.") where each sentence happens to contain *some* relational
 * word; every span passes, yet the cross-utterance relationship is the AI's
 * invention. So some single cited utterance must (a) carry EVERY relational/
 * containment term the claim text itself uses — the connective can't be pasted
 * in from elsewhere — and (b) ground most of the claim's content words, so the
 * relationship isn't re-anchored onto a token-mass-dominant sentence while a
 * short stitched-on tail rides along.
 */
function claimRelationStatedInOneUtterance(
  claim: MirrorClaim,
  bank: Map<string, SourceUtterance>,
  threshold: number,
): boolean {
  const relation = claim.relationSpan;
  if (!relation?.text.trim()) return false;
  const utterance = bank.get(relation.utteranceId)?.text;
  if (
    !utterance ||
    !containsWholePhrase(utterance, relation.text) ||
    !containsWholePhrase(claim.text, relation.text)
  ) {
    return false;
  }
  const content = contentTokens(claim.text);
  if (content.length === 0) return false;
  const uStems = stemSet([utterance]);
  const grounded = content.filter((tok) => uStems.has(stem(tok)));
  return ratio(grounded.length, content.length) >= threshold;
}
function tentativeEvidenceRe(cfg: MindmapConfig): RegExp {
  return new RegExp(cfg.mirror.tentativeEvidencePattern, "i");
}

function hasTentativeEvidence(claim: MirrorClaim, bank: Map<string, SourceUtterance>, cfg: MindmapConfig): boolean {
  const re = tentativeEvidenceRe(cfg);
  return claim.sourceSpans.some((span) => {
    if (re.test(span.userPhrase)) return true;
    return citedTexts(span, bank).some((text) => re.test(text));
  });
}

function checkTentativeUncertainty(
  claim: MirrorClaim,
  bank: Map<string, SourceUtterance>,
  cfg: MindmapConfig,
): MirrorCheckResult {
  if (!hasTentativeEvidence(claim, bank, cfg)) {
    return {
      check: "tentative_uncertainty",
      ok: true,
      score: 1,
      threshold: cfg.mirror.tentativeMirrorMapPressureMin,
    };
  }

  const preservesUncertainty = tentativeEvidenceRe(cfg).test(claim.text);
  return {
    check: "tentative_uncertainty",
    ok: preservesUncertainty,
    score: preservesUncertainty ? 1 : 0,
    threshold: 1,
    parts: [
      {
        name: "uncertainty_preserved",
        ok: preservesUncertainty,
        score: preservesUncertainty ? 1 : 0,
        threshold: 1,
      },
    ],
  };
}

function checkSpanGrounding(
  claim: MirrorClaim,
  bank: Map<string, SourceUtterance>,
  threshold: number,
): { result: MirrorCheckResult; weakest?: SourceSpan } {
  if (claim.sourceSpans.length === 0) {
    return {
      result: { check: "span_grounding", ok: false, score: 0, threshold },
    };
  }

  let weakest: SourceSpan | undefined;
  let weakestScore = Infinity;

  for (const span of claim.sourceSpans) {
    const sources = citedTexts(span, bank);
    const sourceStems = stemSet(sources);
    const phraseContent = contentTokens(span.userPhrase);
    const grounded = phraseContent.filter((tok) => sourceStems.has(stem(tok)));
    // Empty user phrase or no citation => fully ungrounded span.
    const spanScore =
      sources.length === 0 || phraseContent.length === 0
        ? 0
        : ratio(grounded.length, phraseContent.length);
    if (spanScore < weakestScore) {
      weakestScore = spanScore;
      weakest = span;
    }
  }

  // Relationship binding for relational targets.
  let relationshipOk = true;
  if (claim.target === "hierarchy" || claim.target === "connection") {
    const relation = claim.relationSpan;
    relationshipOk =
      !!relation &&
      claim.sourceSpans.some(
        (span) =>
          span.utteranceIds.includes(relation.utteranceId) &&
          spanGroundedInSingleUtterance(span, bank, threshold),
      ) &&
      claimRelationStatedInOneUtterance(claim, bank, threshold);
    if (!relationshipOk) {
      // Point Clarify Mode at the relational gap.
      weakest =
        claim.sourceSpans.find((s) => s.utteranceIds.includes(relation?.utteranceId ?? "")) ??
        weakest ??
        claim.sourceSpans[0];
    }
  }

  const ok = weakestScore >= threshold && relationshipOk;
  return {
    result: { check: "span_grounding", ok, score: weakestScore, threshold },
    weakest: ok ? undefined : weakest,
  };
}

function validateClaim(
  claim: MirrorClaim,
  bank: Map<string, SourceUtterance>,
  bankStems: Set<string>,
  cfg: MindmapConfig,
): ClaimValidation {
  const lexical = checkLexicalGrounding(
    claim,
    bankStems,
    cfg.mirror.lexicalBroadMin,
    cfg.mirror.lexicalAdditionsMax,
  );
  const grounding = checkSpanGrounding(claim, bank, cfg.mirror.spanGroundingMin);
  const tentative = checkTentativeUncertainty(claim, bank, cfg);

  const checks = [lexical, grounding.result, tentative];
  const ok = checks.every((c) => c.ok);

  // The Clarify-Mode hint comes from the weakest span when grounding failed;
  // otherwise from the first failing span we can point at.
  const weakestSpan = grounding.weakest ?? (ok ? undefined : claim.sourceSpans[0]);

  const failed = checks.filter((c) => !c.ok).map((c) => c.check);
  const message = ok
    ? "Reflection is grounded in the user's words."
    : `Mirror blocked — failed: ${failed.join(", ")}. Fall back to a clarifying question.`;

  return { claimId: claim.id, ok, checks, weakestSpan, message };
}

/**
 * Validate a full mirror reflection. Each claim is validated independently so
 * the caller can present passing chunks and re-question on failing ones.
 *
 * `bankUtterances` is the full Source Bank: chat input, direct node edits, and
 * user declarations all count as the user's own words.
 */
export function validateMirror(
  reflection: MirrorReflection,
  bankUtterances: SourceUtterance[],
  cfg: MindmapConfig,
): MirrorValidationResult {
  const bank = new Map(bankUtterances.map((u) => [u.id, u]));
  const bankStems = stemSet(bankUtterances.map((u) => u.text));

  const claims = reflection.claims.map((claim) =>
    validateClaim(claim, bank, bankStems, cfg),
  );

  return { ok: claims.length > 0 && claims.every((c) => c.ok), claims };
}

/** Exposed for tests/debugging: normalized view of how a claim grounds out. */
export function explainClaim(
  claim: MirrorClaim,
  bankUtterances: SourceUtterance[],
): { token: string; owned: boolean; glue: boolean }[] {
  const bankStems = stemSet(bankUtterances.map((u) => u.text));
  return tokenize(claim.text).map((tok) => ({
    token: tok,
    glue: isStopword(tok),
    owned: bankStems.has(stem(tok)),
  }));
}

export { normalize };
