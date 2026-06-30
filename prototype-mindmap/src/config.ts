/**
 * Calibration layer.
 *
 * Everything here is a *tuning* decision, not a *philosophical* one. The
 * philosophical constraints (a mirror must be validated; the AI cannot commit
 * structure; connections must come from the user) live in code and are not
 * configurable. The values below are the knobs we expect to change while
 * running prototype sessions, so they are gathered in one place.
 *
 * None of these are user-facing yet. They are builder/admin calibration.
 */

export interface MirrorThresholds {
  /**
   * Lexical grounding, broad part — minimum fraction of the reflection's
   * *content* words (after stopword removal) that must trace back to the user's
   * words (exact or same-stem). The blunt floor that catches vocabulary drift.
   */
  lexicalBroadMin: number;
  /**
   * Lexical grounding, fine part — maximum fraction of content words allowed to
   * be additions (neither user-owned nor structural glue). The fine ceiling
   * that catches a single meaning-shifting insertion the average let through.
   */
  lexicalAdditionsMax: number;
  /**
   * Span grounding — a claim's source span is considered grounded when this
   * fraction of its content words is present in the cited user utterances.
   * The independent check: relationships must come from the user.
   */
  spanGroundingMin: number;
}

export interface ReadinessThresholds {
  /** Repeated user grounding: weighted evidence score required to mirror. */
  sourceDensityMin: number;
  /** Relational clarity: the user has language for a relationship, not just a topic. */
  relationClarityMin: number;
  /** Predicted risk the mirror validator will reject the reflection. */
  unsupportedRiskMax: number;
  /** Weight of relational language the user produced unprompted. */
  spontaneousWeight: number;
  /** Weight of relational language that echoed the AI's own preceding question. */
  promptedWeight: number;
  /**
   * Hard rule: a hierarchy candidate needs at least one *spontaneous* instance
   * of containment language before it is ever ready to mirror. A hierarchy
   * built entirely from the AI's question framing is not user-authored.
   */
  requireSpontaneousForHierarchy: boolean;
}

export interface PacingConfig {
  /**
   * Derived from the user-facing Think/Map slider. 0 means think-first, 1 means
   * map-first. This does not weaken validation; it only changes pacing and
   * question/mirror preference.
   */
  mapPressure: number;
  /** Minimum questioning turns between two auto-mirror attempts. */
  minQuestionTurnsBetweenMirrors: number;
  /** Wait until at least this many candidates are ready, then mirror them together. */
  minReadyCandidatesToBatch: number;
  /**
   * Soft ceiling on chunks per mirror. Not a hard cap: if more candidates are
   * ready we still mirror them, but we announce the count first. Used to decide
   * when to ask one more question instead of trickling a single chunk.
   */
  softMaxMirrorChunks: number;
  /**
   * Shift question intent from "deepen" to "organize" when total candidates
   * reaches this count — signals enough breadth has been explored.
   */
  organizeIntentCandidateThreshold: number;
  /**
   * Also shift to "organize" when this many candidates are ready to mirror —
   * signals enough depth exists to ask relational/structural questions.
   */
  organizeIntentReadyThreshold: number;
}

export interface MindmapConfig {
  mirror: MirrorThresholds;
  readiness: ReadinessThresholds;
  pacing: PacingConfig;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

/**
 * User-facing think/map bias. This only changes question framing thresholds:
 * it never changes validator, readiness, or grounding gates.
 */
export function withQuestionIntentBias(
  config: MindmapConfig,
  bias: number,
): MindmapConfig {
  const normalized = Math.max(0, Math.min(100, bias));
  const thinkLean = Math.max(0, 50 - normalized) / 50;
  const mapLean = Math.max(0, normalized - 50) / 50;
  const candidateShift = thinkLean * 2 - mapLean;
  const readyShift = thinkLean - mapLean;
  const mirrorTurnShift = thinkLean * 2 - mapLean * 2;
  const batchShift = thinkLean - mapLean;

  return {
    ...config,
    mirror: { ...config.mirror },
    readiness: { ...config.readiness },
    pacing: {
      ...config.pacing,
      mapPressure: mapLean,
      minQuestionTurnsBetweenMirrors: clampInt(
        config.pacing.minQuestionTurnsBetweenMirrors + mirrorTurnShift,
        1,
        7,
      ),
      minReadyCandidatesToBatch: clampInt(
        config.pacing.minReadyCandidatesToBatch + batchShift,
        1,
        4,
      ),
      organizeIntentCandidateThreshold: clampInt(
        config.pacing.organizeIntentCandidateThreshold + candidateShift,
        2,
        8,
      ),
      organizeIntentReadyThreshold: clampInt(
        config.pacing.organizeIntentReadyThreshold + readyShift,
        1,
        6,
      ),
    },
  };
}

/**
 * Prototype defaults. Starting points for calibration, not sacred math.
 */
export const defaultConfig: MindmapConfig = {
  mirror: {
    lexicalBroadMin: 0.8,
    lexicalAdditionsMax: 0.15,
    spanGroundingMin: 0.75,
  },
  readiness: {
    sourceDensityMin: 0.7,
    relationClarityMin: 0.7,
    unsupportedRiskMax: 0.2,
    spontaneousWeight: 1.0,
    promptedWeight: 0.5,
    requireSpontaneousForHierarchy: true,
  },
  pacing: {
    mapPressure: 0,
    minQuestionTurnsBetweenMirrors: 3,
    minReadyCandidatesToBatch: 2,
    softMaxMirrorChunks: 4,
    organizeIntentCandidateThreshold: 3,
    organizeIntentReadyThreshold: 2,
  },
};
