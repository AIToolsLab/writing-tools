/**
 * Mirror tool contract — what the LLM (or mock) emits each turn.
 *
 * The LLM is called with a snapshot of the session state and returns a
 * structured turn. Code (not prompting) enforces what happens next:
 *   - mirror proposals go through validateMirror before anything is shown
 *   - candidate updates are applied to the store, never exposed raw
 *   - clarify targets come from the weakest failing span, set by the validator
 */

import type { DetectedSignal } from "./signals";
import type { DraftDeclaration } from "./draft-declarations";
import type { TurnShape } from "./turn-shape";
import type {
  CandidateTarget,
  CandidateThought,
  MirrorReflection,
  SourceSpan,
  SourceUtterance,
  ThoughtUnit,
} from "./types";

export type LLMMode = "question" | "mirror" | "clarify";
export type QuestionStance =
  | "settle"
  | "narrow"
  | "deepen"
  | "organize"
  | "challenge";

/**
 * Upsert instruction for a candidate. The LLM may propose the *grouping*
 * (which utterances support which candidate, plus a gist and target) — but it
 * may NOT supply relation signals or spontaneity. Those are derived in code
 * from deterministic signal detection so the readiness gate cannot be gamed.
 * Merging is handled by CandidateStore.
 */
export interface CandidateUpsert {
  id: string;
  target: CandidateTarget;
  gist: string;
  addEvidenceIds: string[];
}

export type MapCommandKind = "create_card" | "nest_card" | "connect_cards";

export interface MapCommandSourceSpan {
  utteranceIds?: string[];
  userPhrase: string;
}

/**
 * Direct user map commands are side effects, orthogonal to the chat mode. The
 * controller executes them only after exact wording/reference checks or an
 * explicit user confirmation of a near-match reference.
 */
export interface MapCommand {
  kind: MapCommandKind;
  text?: string;
  sourceSpan?: MapCommandSourceSpan;
  childText?: string;
  parentText?: string;
  sourceText?: string;
  targetText?: string;
  labelText?: string;
}

/**
 * One structured turn from the LLM (or deterministic mock).
 *
 * `text` is the natural-language output shown to the user (question,
 * mirror preamble, or clarify question). `mirror` is only set when
 * mode === "mirror"; `clarifySpan` only when mode === "clarify".
 */
export interface LLMTurn {
  mode: LLMMode;
  /** The string presented to the user for this turn. */
  text: string;
  /** Proposed reflection — only present when mode === "mirror". */
  mirror?: MirrorReflection;
  /**
   * The span the LLM intends to probe — populated when mode === "clarify"
   * and the controller routed here because validation failed on that span.
   */
  clarifySpan?: SourceSpan;
  candidateUpserts?: CandidateUpsert[];
  candidateDeletes?: string[];
  /**
   * Direct map commands the user issued this turn. These are not mirrors and do
   * not need user confirmation when accepted by controller checks.
   */
  mapCommands?: MapCommand[];
  /**
   * Candidate ids the user explicitly committed to carrying forward this turn.
   * The controller treats this only as an interpretation signal: it may speed
   * density readiness for idea candidates, but never for hierarchy/connection
   * structure and never outside validation/user confirmation.
   */
  carryForwardCandidateIds?: string[];
  /**
   * Verbatim substring of the draft the question is anchored to.
   * The UI highlights this region in the draft panel.
   * Only meaningful when mode === "question" or "clarify" and a draft exists.
   */
  questionAnchor?: string;
  /**
   * Coaching intent for question-mode turns.
   * "deepen" — dig into one concept (what it is, what it does, assumptions).
   * "organize" — ask structural/relational questions (hierarchy, connections).
   * Only meaningful when mode === "question"; omitted otherwise.
   */
  questionIntent?: "deepen" | "organize";
  /**
   * Conversation pressure/style for question-mode turns.
   * settle: user seems overwhelmed or unsure; narrow: user is vague; deepen:
   * unpack one idea; organize: ask about map/draft structure; challenge:
   * examine a stated assumption without supplying the answer.
   */
  questionStance?: QuestionStance;
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

export interface LLMMapContext {
  thoughtUnits: ThoughtUnit[];
  connections: LLMMapConnection[];
}

/** Context snapshot handed to the LLM (or mock) each turn. */
export interface LLMContext {
  bank: SourceUtterance[];
  candidates: CandidateThought[];
  turnsSinceLastMirror: number;
  clarifyTarget?: SourceSpan;
  /** Structural signals detected deterministically from the latest user utterance. */
  detectedSignals: DetectedSignal[];
  /** Candidate IDs that passed evaluateReadiness — only these may be mirrored. */
  readyCandidateIds: string[];
  /** True when the user's message contains stuck language ("I'm not sure" etc.). */
  userIsStuck: boolean;
  /** The AI's previous turn text, for reference in prompt construction. */
  lastAiText: string;
  /** The full raw user input for this turn (before segmentation). */
  turnText: string;
  /**
   * Code-derived shape of the latest turn. Advisory/suppression-only: it never
   * authorizes candidates, mirrors, commands, or map writes.
   */
  turnShape: TurnShape;
  /** Newly-confirmed user-authored structure the next coach turn should build on. */
  continuationFocus?: string[];
  /** Current coach ask the user is responding to, if the controller is tracking one. */
  activeElicitation?: {
    kind: "carry_forward" | "clarify_after_failed_mirror" | "sparse_map_next_card";
    targetPhrase?: string;
  };
  /** Current organize focus, if the coach recently asked about a specific card pair. */
  organizeFocus?: {
    refs: string[];
    declineCount: number;
  };
  /** True when the map is still too sparse for relational organize questions. */
  sparseMapBlocksOrganize?: boolean;
  /** The user's current draft text, if provided. Used for anchoring questions to draft regions. */
  draft?: string;
  /**
   * Explicit declarations or high-confidence repeated focus detected in the
   * draft. Suppression-only: these are never candidates, never mirror evidence,
   * and never map commands.
   */
  draftDeclarations: DraftDeclaration[];
  /** User-authored concept map state. The model may ask about it, never place structure. */
  map: LLMMapContext;
}

/** Sync in tests, async when wired to the real backend. */
export type MockLLM = (ctx: LLMContext) => LLMTurn | Promise<LLMTurn>;
