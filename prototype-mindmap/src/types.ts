/**
 * Domain types for the reflective mind-map core.
 *
 * Naming is deliberate: nothing the AI privately tracks is called a "node".
 * The AI accumulates *candidate thoughts* (evidence of emerging structure),
 * never decisions about structure. Only the user, via confirmation, turns a
 * reflection into a committed thought unit.
 */

// ---------------------------------------------------------------------------
// Source Bank — the ground truth of user language
// ---------------------------------------------------------------------------

export type UtteranceOrigin = "chat" | "node_edit" | "declaration";

/** A single thing the user said or wrote. Never edited by the AI. */
export interface SourceUtterance {
  id: string;
  text: string;
  timestamp: number;
  origin: UtteranceOrigin;
  /** Groups sentence-level units that came from one input (one turn / paste). */
  turnId?: string;
  /** Ground-truth command wording kept for provenance, but excluded from mirrors. */
  commandOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Candidate Thought Store — the AI's working evidence (never shown raw)
// ---------------------------------------------------------------------------

export type CandidateTarget = "idea" | "hierarchy" | "connection";

/** One instance of relational/containment language the user produced. */
export interface RelationSignal {
  /** The user phrase carrying the relationship, e.g. "sits inside". */
  phrase: string;
  utteranceId: string;
  /**
   * True when the user introduced this relational language unprompted; false
   * when it echoed the AI's immediately preceding question. Spontaneous signals
   * are stronger evidence that the structure is actually in the user's head.
   */
  spontaneous: boolean;
}

/**
 * Evidence of an emerging idea, hierarchy, or connection. This is a hypothesis,
 * not a node. It only becomes structure after the user confirms a reflection
 * built from it.
 */
export interface CandidateThought {
  id: string;
  target: CandidateTarget;
  /** User utterances that contributed evidence for this candidate. */
  evidenceUtteranceIds: string[];
  /** Relational language gathered for this candidate (empty for pure "idea"). */
  relationSignals: RelationSignal[];
  /** Free-text gist the AI is tracking internally; never shown as-is to the user. */
  gist: string;
}

// ---------------------------------------------------------------------------
// Mirror — what the AI proposes to reflect back, and how it is validated
// ---------------------------------------------------------------------------

/** Annotation linking a piece of a reflection to its grounding in user words. */
export interface SourceSpan {
  /** The portion of the reflection this span supports. */
  claimText: string;
  /** User utterances that ground it. */
  utteranceIds: string[];
  /** The user's own phrase the AI is leaning on. */
  userPhrase: string;
}

/** One independently confirmable structural claim in a mirror reflection. */
export interface MirrorClaim {
  id: string;
  /** Phenomenological wording shown to the user — never the word "node". */
  text: string;
  candidateId: string;
  target: CandidateTarget;
  sourceSpans: SourceSpan[];
}

/** A full mirror attempt: one or more chunked claims submitted to the validator. */
export interface MirrorReflection {
  claims: MirrorClaim[];
}

export type MirrorCheckName = "lexical_grounding" | "span_grounding" | "tentative_uncertainty";

/** A sub-part of a check, reported for transparency/calibration. */
export interface MirrorCheckPart {
  name: string;
  ok: boolean;
  score: number;
  threshold: number;
}

export interface MirrorCheckResult {
  check: MirrorCheckName;
  ok: boolean;
  /** Measured value (a ratio) for logging/calibration. */
  score: number;
  /** Threshold it was compared against. */
  threshold: number;
  /**
   * Sub-parts, when a check has more than one. Lexical grounding has two:
   * a broad overlap part and a fine additions part. The check passes only
   * if every part passes.
   */
  parts?: MirrorCheckPart[];
}

/** Result of validating a single claim. All checks must pass for `ok`. */
export interface ClaimValidation {
  claimId: string;
  ok: boolean;
  checks: MirrorCheckResult[];
  /** When a claim fails, the span the AI should ask about in Clarify Mode. */
  weakestSpan?: SourceSpan;
  message: string;
}

export interface MirrorValidationResult {
  ok: boolean;
  claims: ClaimValidation[];
}

// ---------------------------------------------------------------------------
// Readiness — whether a candidate may be mirrored yet
// ---------------------------------------------------------------------------

export type ReadinessDecision = "attempt_mirror" | "ask_clarifying_question";

export interface ReadinessSignal {
  candidateId: string;
  target: CandidateTarget;
  sourceDensity: number;
  relationClarity: number;
  unsupportedRisk: number;
  decision: ReadinessDecision;
  /** When decision is to clarify, which signal was weak/missing. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Confirmed structure — only the user can author this
// ---------------------------------------------------------------------------

/**
 * A reflection the user accepted. The only thing allowed to become a visual
 * thought unit. Carries provenance back to the user's own words.
 */
export interface ConfirmedReflection {
  id: string;
  text: string;
  candidateId: string;
  target: CandidateTarget;
  sourceUtteranceIds: string[];
  confirmedAt: number;
}

/**
 * A unit in the mind map. Its *role* (node / sub-node / content / connection
 * label) is assigned by the user and can change over time — content can be
 * promoted to a sub-node, a connection label can become a node. The system
 * may ask when a role change looks warranted; it never decides one.
 */
export type ThoughtUnitRole = "node" | "subnode" | "content" | "connection_label";

export interface RoleHistoryEntry {
  role: ThoughtUnitRole;
  changedBy: "user" | "ai_proposed_user_confirmed";
  at: number;
}

export interface ThoughtUnit {
  id: string;
  text: string;
  role: ThoughtUnitRole;
  parentId?: string;
  /** Provenance: every unit traces to user words and (if AI-captured) a reflection. */
  source: {
    reflectionId?: string;
    utteranceIds: string[];
    createdBy: "user" | "ai_from_reflection";
  };
  roleHistory: RoleHistoryEntry[];
}
