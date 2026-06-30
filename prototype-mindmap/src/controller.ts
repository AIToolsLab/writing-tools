/**
 * Mode controller — the headless loop for M1a.
 *
 * Orchestration rules (all enforced in code):
 *   1. A mirror proposal is always validated before any output is returned.
 *   2. If validation fails, the turn becomes a Clarify turn targeted at the
 *      weakest failing span — the LLM's mirror intent is silently discarded.
 *   3. Pacing: if turnsSinceLastMirror < minQuestionTurnsBetweenMirrors, a
 *      mirror proposal is converted to a question turn instead.
 *   4. Candidate updates from the LLM are applied before readiness is checked.
 *   5. The LLM never sees ConfirmedReflections or ThoughtUnits in M1 — those
 *      live outside the loop for now.
 */

import type { MindmapConfig } from "./config";
import { defaultConfig } from "./config";
import type { LLMContext, LLMMapContext, LLMTurn, MockLLM, QuestionStance } from "./llm-contract";
import { contentTokens } from "./normalize";
import { evaluateReadiness, readyCandidates } from "./readiness";
import { detectSignals } from "./signals";
import { CandidateStore, SourceBank } from "./store";
import type {
  ClaimValidation,
  MirrorReflection,
  RelationSignal,
  SourceSpan,
  UtteranceOrigin,
} from "./types";
import { validateMirror } from "./validator";

export type ControllerMode = "question" | "mirror" | "clarify";
export type SuppressionReason =
  | "cooldown"
  | "missing_mirror_payload"
  | "not_ready"
  | "batch_preference"
  | "validation_failed";

/**
 * Fixed user-facing preamble for a passing mirror. The actual reflection is the
 * set of validated, confirmable claims — never free LLM prose, which could
 * smuggle in authored framing.
 */
export const MIRROR_PREAMBLE =
  "Here's the structure I'm hearing in your words — check each part:";

export interface LoopState {
  bank: SourceBank;
  candidates: CandidateStore;
  mode: ControllerMode;
  turnsSinceLastMirror: number;
  clarifyTarget?: SourceSpan;
  /** Text of the last AI turn — passed to detectSignals for spontaneity scoring. */
  lastAiText: string;
  /** Current draft text — passed to LLM for context and anchor highlighting. */
  draft: string;
}

const STUCK_PHRASES = [
  "i'm not sure", "im not sure", "i am not sure",
  "i don't know", "i dont know", "not sure",
  "i'm stuck", "im stuck", "unsure", "i'm lost", "im lost", "lost",
  "i don't understand", "i cant think", "i can't think", "i have no idea",
  // Confusion phrasings — these signal the user is lost and we must NOT re-pin
  // the same clarify span at them.
  "confus", "don't get", "dont get", "what do you mean",
  "i don't follow", "i dont follow", "no idea",
];
const CARRY_FORWARD_MIN_CONTENT_TOKENS = 3;

function isStuck(text: string): boolean {
  const lower = text.toLowerCase();
  return STUCK_PHRASES.some((p) => lower.includes(p));
}

function isSuggestiveStructuralQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  const offersChoice = /\b(or|instead of)\b/.test(lower);
  if (!offersChoice) return false;

  return (
    /\b(under|inside|alongside|bigger|broader|smaller|claim|category|cause|effect|principle|belongs|sits)\b/.test(lower) ||
    /\b(software idea|authorship claim|offering ideas|contributing ideas|giving ideas|suggesting ideas)\b/.test(lower)
  );
}

function intersects(a: Iterable<string>, b: ReadonlySet<string>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function formatRatio(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

function validationDetail(claims: ClaimValidation[]): string {
  const failing = claims.find((claim) => !claim.ok);
  const failedCheck = failing?.checks.find((check) => !check.ok);
  if (!failing || !failedCheck) return "Validation failed.";
  const parts = failedCheck.parts
    ?.map((part) => `${part.name} ${formatRatio(part.score)}/${formatRatio(part.threshold)}`)
    .join(", ");
  const score = `${failedCheck.check} ${formatRatio(failedCheck.score)}/${formatRatio(failedCheck.threshold)}`;
  return parts ? `${score}; ${parts}` : score;
}

function buildValidationDebug(
  mirror: MirrorReflection,
  failingClaims: ClaimValidation[],
  bank: SourceBank,
): ValidationDebugClaim[] {
  const claimsById = new Map(mirror.claims.map((claim) => [claim.id, claim]));
  return failingClaims.map((validation) => {
    const claim = claimsById.get(validation.claimId);
    return {
      claimId: validation.claimId,
      claimText: claim?.text ?? "",
      target: claim?.target ?? "",
      message: validation.message,
      checks: validation.checks,
      sourceSpans:
        claim?.sourceSpans.map((span) => ({
          claimText: span.claimText,
          userPhrase: span.userPhrase,
          utteranceIds: span.utteranceIds,
          citedUtterances: span.utteranceIds
            .map((id) => {
              const utterance = bank.get(id);
              return utterance ? { id, text: utterance.text } : undefined;
            })
            .filter((u): u is { id: string; text: string } => u !== undefined),
        })) ?? [],
    };
  });
}

export interface ValidationDebugClaim {
  claimId: string;
  claimText: string;
  target: string;
  message: string;
  checks: Array<{
    check: string;
    ok: boolean;
    score: number;
    threshold: number;
    parts?: Array<{
      name: string;
      ok: boolean;
      score: number;
      threshold: number;
    }>;
  }>;
  sourceSpans: Array<{
    claimText: string;
    userPhrase: string;
    utteranceIds: string[];
    citedUtterances: Array<{ id: string; text: string }>;
  }>;
}

export interface TurnOutput {
  /** Mode after this turn resolves. */
  mode: ControllerMode;
  /** What to show the user. */
  text: string;
  /** Raw LLM turn for inspection/testing. */
  llmTurn: LLMTurn;
  /** Set when a mirror passed validation and is ready for user confirmation. */
  validatedMirror?: {
    reflection: MirrorReflection;
    claims: ClaimValidation[];
  };
  /**
   * Set when a mirror was blocked. The controller already switched to
   * clarify mode; these are the failing claims for logging/calibration.
   */
  blockedClaims?: ClaimValidation[];
  /**
   * Set when a mirror was suppressed by pacing (too soon after the last one)
   * rather than by validation failure.
   */
  pacingSuppressed?: boolean;
  /** Machine-readable reason a mirror attempt was not shown as a mirror. */
  suppressionReason?: SuppressionReason;
  /** Human/debug detail, usually from readiness or validation. */
  suppressionDetail?: string;
  /** Full failed validation payload for tester/debug inspection. */
  validationDebug?: ValidationDebugClaim[];
  /** Debug visibility for candidates whose idea density was accelerated. */
  acceleratedCandidateIds?: string[];
  readinessNotes?: string[];
  /** Verbatim draft substring the AI anchored its question/clarify to, if any. */
  questionAnchor?: string;
  /** The coaching stance the AI chose for this question/clarify turn, if any. */
  questionStance?: QuestionStance;
}

export function createState(_config?: MindmapConfig): LoopState {
  return {
    bank: new SourceBank(),
    candidates: new CandidateStore(),
    mode: "question",
    turnsSinceLastMirror: 0,
    lastAiText: "",
    draft: "",
  };
}

export async function processTurn(
  state: LoopState,
  userText: string,
  llm: MockLLM,
  config: MindmapConfig = defaultConfig,
  origin: UtteranceOrigin = "chat",
  map: LLMMapContext = { thoughtUnits: [], connections: [] },
): Promise<TurnOutput> {
  // 1. Record the user's words, segmented into sentence-level units so a big
  //    voice chunk becomes several grounded units rather than one opaque blob.
  const units = state.bank.addSegmented(userText, origin);

  // 2. Deterministic structural-signal detection PER UNIT (spontaneity scored
  //    against the AI's previous turn so the LLM can't game it). Per-unit means
  //    a relationship signal is tied to the specific sentence that carries it.
  const detectedSignals = units.flatMap((u) =>
    detectSignals(u.id, u.text, state.lastAiText),
  );

  // 3. Pre-turn ready candidates — passed in LLM context so it knows what it
  //    may mirror. (Computed before candidate updates so it reflects prior state.)
  const preTurnReadyIds = readyCandidates(
    state.candidates.getAll(),
    state.bank.getAll(),
    config,
  ).map((s) => s.candidateId);

  // 4. Build context snapshot and call the LLM.
  const userIsStuck = isStuck(userText);
  const ctx: LLMContext = {
    bank: state.bank.getAll(),
    candidates: state.candidates.getAll(),
    turnsSinceLastMirror: state.turnsSinceLastMirror,
    clarifyTarget: state.clarifyTarget,
    detectedSignals,
    readyCandidateIds: preTurnReadyIds,
    userIsStuck,
    lastAiText: state.lastAiText,
    turnText: userText,
    draft: state.draft || undefined,
    map,
  };
  const turn = await llm(ctx);

  // 5. Apply candidate updates from the LLM, then recompute readiness for gating.
  //    The LLM proposes grouping (gist/target/evidence) only. Relation signals
  //    and spontaneity are CODE-DERIVED from this turn's deterministic detection,
  //    so the LLM cannot fabricate the inputs that drive the readiness gate.
  const signalsByUtt = new Map<string, RelationSignal[]>();
  for (const s of detectedSignals) {
    const rs: RelationSignal = {
      phrase: s.phrase,
      utteranceId: s.utteranceId,
      spontaneous: s.spontaneous,
    };
    const arr = signalsByUtt.get(s.utteranceId) ?? [];
    arr.push(rs);
    signalsByUtt.set(s.utteranceId, arr);
  }
  for (const u of turn.candidateUpserts ?? []) {
    // Evidence ids must reference real utterances in the bank.
    const validEvidence = u.addEvidenceIds.filter(
      (id) => state.bank.get(id) !== undefined,
    );
    // Attach only signals the detector actually found on this turn's utterance,
    // to candidates the LLM says that utterance supports.
    const derivedSignals: RelationSignal[] = [];
    for (const id of validEvidence) {
      for (const rs of signalsByUtt.get(id) ?? []) derivedSignals.push(rs);
    }
    state.candidates.upsert({
      id: u.id,
      target: u.target,
      gist: u.gist,
      evidenceUtteranceIds: validEvidence,
      relationSignals: derivedSignals,
    });
  }
  for (const id of turn.candidateDeletes ?? []) {
    state.candidates.delete(id);
  }

  // Post-update readiness — this is what actually gates the mirror.
  const thisTurnUtteranceIds = new Set(units.map((u) => u.id));
  const substantiveThisTurnUtteranceIds = new Set(
    units
      .filter((u) => contentTokens(u.text).length >= CARRY_FORWARD_MIN_CONTENT_TOKENS)
      .map((u) => u.id),
  );
  const acceleratedEvidenceByCandidate = new Map<string, Set<string>>();
  for (const candidateId of turn.carryForwardCandidateIds ?? []) {
    const candidate = state.candidates.get(candidateId);
    if (!candidate || candidate.target !== "idea") continue;
    const thisTurnEvidence = candidate.evidenceUtteranceIds.filter(
      (id) => thisTurnUtteranceIds.has(id) && substantiveThisTurnUtteranceIds.has(id),
    );
    if (thisTurnEvidence.length === 0) continue;
    acceleratedEvidenceByCandidate.set(candidateId, new Set(thisTurnEvidence));
  }
  const acceleratedIdeaIds = new Set(acceleratedEvidenceByCandidate.keys());
  const normalPostUpdateReadyIds = readyCandidates(
    state.candidates.getAll(),
    state.bank.getAll(),
    config,
  ).map((s) => s.candidateId);
  const postUpdateReadyIds = readyCandidates(
    state.candidates.getAll(),
    state.bank.getAll(),
    config,
    acceleratedIdeaIds,
  ).map((s) => s.candidateId);
  const postUpdateReadiness = state.candidates
    .getAll()
    .map((candidate) => evaluateReadiness(candidate, state.bank.getAll(), config, acceleratedIdeaIds));
  const readinessByCandidate = new Map(postUpdateReadiness.map((signal) => [signal.candidateId, signal]));

  // De-escalation used to break a verbatim-repeat loop (see finish()).
  const DE_ESCALATE =
    "Let's zoom out a little — what's one small piece of this you feel sure about?";
  const MIRROR_SUPPRESSED_QUESTION =
    "What part of that feels most important to carry forward on the map?";
  const MIRROR_SUPPRESSED_REPEAT_QUESTION =
    "What exact wording do you want the map to carry forward from that?";
  const normalizeText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

  function finish(out: TurnOutput): TurnOutput {
    if (
      (out.mode === "question" || out.mode === "clarify") &&
      (turn.questionIntent === "organize" || turn.questionStance === "organize") &&
      isSuggestiveStructuralQuestion(out.text)
    ) {
      out = {
        ...out,
        text: "How would you describe the relationship between those two thoughts in your own words?",
        questionAnchor: undefined,
        questionStance: "organize",
      };
    }

    // Anti-repeat guard: if a question/clarify turn would say verbatim what we
    // just said, the model is stuck in a loop (e.g. re-asking the same pinned
    // clarify span). Swap in a de-escalating question and drop the pin so the
    // next turn is free to re-angle. Mirror turns are exempt — their fixed
    // preamble repeats legitimately and the validated claims differ.
    if (
      (out.mode === "question" || out.mode === "clarify") &&
      state.lastAiText &&
      normalizeText(out.text) === normalizeText(state.lastAiText)
    ) {
      if (out.pacingSuppressed) {
        out = {
          ...out,
          text: MIRROR_SUPPRESSED_REPEAT_QUESTION,
          questionAnchor: undefined,
          questionStance: "organize",
        };
      } else {
        // A forced de-escalation IS a settle move.
        out = { ...out, text: DE_ESCALATE, questionAnchor: undefined, questionStance: "settle" };
        state.clarifyTarget = undefined;
      }
    } else if (
      (out.mode === "question" || out.mode === "clarify") &&
      out.questionStance === undefined
    ) {
      out = { ...out, questionStance: turn.questionStance };
    }
    state.lastAiText = out.text;
    return out;
  }

  // 5.5. Stuck override (enforced in code, not prompt). If the user signalled
  //      they're stuck, we never mirror and never "move on" with a fresh topic —
  //      we force a clarify turn that re-angles on what they're unsure about.
  if (userIsStuck) {
    state.mode = "clarify";
    state.turnsSinceLastMirror++;
    // A confused user must NOT be re-pinned to the span they're confused by.
    // Drop the pin so we de-escalate and re-angle instead of re-asking it.
    state.clarifyTarget = undefined;
    const text =
      turn.mode === "question" || turn.mode === "clarify"
        ? turn.text
        : "Let's slow down — what's one part of this you feel surest about?";
    return finish({ mode: "clarify", text, llmTurn: turn, questionAnchor: turn.questionAnchor });
  }

  // 6. Route based on LLM's intended mode.
  if (turn.mode === "mirror") {
    // 6a. Pacing check — too soon?
    if (
      state.turnsSinceLastMirror <
      config.pacing.minQuestionTurnsBetweenMirrors
    ) {
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({ mode: "question", text: MIRROR_SUPPRESSED_QUESTION, llmTurn: turn, pacingSuppressed: true, suppressionReason: "cooldown", questionStance: "organize" });
    }

    if (!turn.mirror) {
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({ mode: "question", text: MIRROR_SUPPRESSED_QUESTION, llmTurn: turn, pacingSuppressed: true, suppressionReason: "missing_mirror_payload", questionStance: "organize" });
    }

    // 6b. Readiness gate — only claims for post-update ready candidates pass.
    const normalReadySet = new Set(normalPostUpdateReadyIds);
    const readySet = new Set(postUpdateReadyIds);
    const gatedClaims = turn.mirror.claims.filter((c) => {
      if (normalReadySet.has(c.candidateId)) return true;
      if (!readySet.has(c.candidateId)) return false;
      const acceleratedEvidence = acceleratedEvidenceByCandidate.get(c.candidateId);
      if (!acceleratedEvidence) return false;
      return c.sourceSpans.some((span) => intersects(span.utteranceIds, acceleratedEvidence));
    });

    if (gatedClaims.length === 0) {
      // LLM tried to mirror but no candidate was ready — downgrade to question.
      const firstClaim = turn.mirror.claims[0];
      const candidateReadiness = firstClaim ? readinessByCandidate.get(firstClaim.candidateId) : undefined;
      const suppressionDetail =
        firstClaim && readySet.has(firstClaim.candidateId)
          ? "Accelerated mirror did not cite the carry-forward utterance."
          : candidateReadiness?.reason ?? "No mirror claim targeted a ready candidate.";
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({ mode: "question", text: MIRROR_SUPPRESSED_QUESTION, llmTurn: turn, pacingSuppressed: true, suppressionReason: "not_ready", suppressionDetail, questionStance: "organize" });
    }

    const hasAcceleratedGatedClaim = gatedClaims.some((claim) =>
      acceleratedIdeaIds.has(claim.candidateId),
    );
    if (
      postUpdateReadyIds.length < config.pacing.minReadyCandidatesToBatch &&
      !hasAcceleratedGatedClaim
    ) {
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({ mode: "question", text: MIRROR_SUPPRESSED_QUESTION, llmTurn: turn, pacingSuppressed: true, suppressionReason: "batch_preference", suppressionDetail: `${postUpdateReadyIds.length}/${config.pacing.minReadyCandidatesToBatch} ready candidates`, questionStance: "organize" });
    }

    const gatedMirror = { claims: gatedClaims };

    // 6c. Validation check.
    const result = validateMirror(gatedMirror, state.bank.getAll(), config);

    if (result.ok) {
      const usedAcceleratedIds = [...acceleratedIdeaIds].filter((id) =>
        gatedClaims.some((claim) => claim.candidateId === id),
      );
      state.turnsSinceLastMirror = 0;
      state.mode = "mirror";
      state.clarifyTarget = undefined;
      return finish({
        // Fixed preamble — never the LLM's free prose, which is unvalidated.
        text: MIRROR_PREAMBLE,
        mode: "mirror",
        llmTurn: turn,
        validatedMirror: { reflection: gatedMirror, claims: result.claims },
        acceleratedCandidateIds: usedAcceleratedIds,
        readinessNotes: usedAcceleratedIds.map((id) => `accelerated idea density: ${id}`),
      });
    }

    // Mirror blocked — route to clarify on weakest failing span.
    const failingClaims = result.claims.filter((c) => !c.ok);
    const weakestSpan = failingClaims
      .map((c) => c.weakestSpan)
      .find((s): s is SourceSpan => s !== undefined);

    state.mode = "clarify";
    state.clarifyTarget = weakestSpan;
    state.turnsSinceLastMirror++;

    const clarifyText =
      weakestSpan != null
        ? `I want to make sure I understand — when you said "${weakestSpan.userPhrase}", what did you mean by that?`
        : "I want to make sure I understood that correctly — can you say more?";

    return finish({
      mode: "clarify",
      text: clarifyText,
      llmTurn: turn,
      blockedClaims: failingClaims,
      suppressionReason: "validation_failed",
      suppressionDetail: validationDetail(failingClaims),
      validationDebug: buildValidationDebug(gatedMirror, failingClaims, state.bank),
    });
  }

  if (turn.mode === "clarify") {
    state.mode = "clarify";
    state.clarifyTarget = turn.clarifySpan;
    state.turnsSinceLastMirror++;
    return finish({ mode: "clarify", text: turn.text, llmTurn: turn, questionAnchor: turn.questionAnchor });
  }

  // Default: question.
  state.mode = "question";
  state.turnsSinceLastMirror++;
  return finish({ mode: "question", text: turn.text, llmTurn: turn, questionAnchor: turn.questionAnchor });
}
