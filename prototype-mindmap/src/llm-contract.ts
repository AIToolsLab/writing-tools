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
import type { OpenThreadContext } from "./open-threads";
import type { TurnShape } from "./turn-shape";
import type {
  CandidateTarget,
  CandidateThought,
  MirrorReflection,
  SourceSpan,
  SourceUtterance,
  ThoughtUnit,
  ThoughtUnitRole,
} from "./types";

export type LLMMode = "question" | "mirror" | "clarify";
export type QuestionStance =
  | "settle"
  | "narrow"
  | "deepen"
  | "organize"
  | "challenge";

/**
 * A user-initiated override of the coach's next move, chosen from the Under the
 * Hood panel. A deliberately small, user-facing subset of the coach's behaviors
 * so the user can steer (and unstick) the turn without ever authoring map writes
 * or seeing model scaffolding. Maps onto the LLM contract as:
 *   - "mirror"   -> mode "mirror"
 *   - "deepen"   -> mode "question", questionIntent "deepen"
 *   - "organize" -> mode "question", questionIntent "organize"
 *   - "pivot"    -> mode "question": the user's escape hatch. Drop the current
 *                   question/focus and ask a fresh, easy hand-back — never re-ask
 *                   or narrow the same thing.
 */
export type UserRequestedMode = "mirror" | "deepen" | "organize" | "pivot";

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

export type MapCommandKind = "create_card" | "nest_card" | "connect_cards" | "edit_card";

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
  cardText?: string;
  newText?: string;
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
  /**
   * The turn is a pure conversational aside with NO writing content — venting,
   * confusion about the tool, a greeting/thanks, off-topic, or unparseable. When
   * set (and the controller agrees the turn carries no substantive content), the
   * coach answers briefly and honestly and the controller FENCES it: no map
   * commands, no candidate harvest, no clarify/elicitation changes. `text` is the
   * aside. Never use this to dodge a real answer — if the turn also contains
   * writing content, leave it unset and let normal coaching run.
   */
  metaIntent?: MetaIntent;
  /**
   * How the user seems to be feeling this turn. A TONE/PACING modifier only — it
   * never fences anything, never drops content, and works on ANY turn including a
   * productive one. When drained/overwhelmed/frustrated, the controller softens
   * and drops the map-ward pressure nudges. "energized" leaves pacing unchanged.
   */
  affect?: UserAffect;
}

export type MetaIntent = "emotional" | "confused" | "social" | "off_topic" | "unparseable";
export type UserAffect = "exhausted" | "frustrated" | "overwhelmed" | "energized";

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

/**
 * A read-only, code-derived anchor from the current map for map-aware
 * questioning: a card's ref + text and the refs/text of cards it connects to.
 * Deliberately excludes direction metadata. The model may reference these in a
 * question as a conversational anchor; it never authorizes placing, renaming,
 * connecting, or proposing structure.
 */
export interface MapQuestionAnchor {
  ref: string;
  text: string;
  neighbors: Array<{ ref: string; text: string }>;
}

export interface SelectedFocusContext {
  cards?: Array<{
    id: string;
    ref: string;
    text: string;
    role: Exclude<ThoughtUnitRole, "connection_label">;
  }>;
  draftText?: string;
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
  /**
   * Deterministic floor for affect: true when the user's wording clearly reads
   * as drained/overwhelmed ("I'm exhausted", "this is too much"). A backup for
   * when the model doesn't set `affect` itself. When true the coach should
   * acknowledge gently and NOT push toward the map. It never forces harshness —
   * it only ever adds gentleness.
   */
  userSeemsDrained?: boolean;
  /**
   * The capabilities manifest — product truth about what this tool can and
   * cannot do. Optional on the context: `api.ts` falls back to the config
   * manifest when a caller (e.g. a test) omits it.
   */
  capabilities?: { canDo: string[]; cantDo: string[] };
  /**
   * True when the user explicitly asked the coach for help focusing, a
   * recommendation, or possible directions ("where could we go from here?",
   * "any recommendation?"). The coach MAY offer grounded options/lenses and ask
   * the user to choose — but must still never author structure or mutate the map.
   */
  focusHelpIntent?: boolean;
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
  /**
   * Bounded source-bank slice from an earlier large exploratory turn that the
   * user has now selected or is elaborating. Advisory only: it narrows support
   * to a chosen strand; it never authorizes harvesting the whole turn.
   */
  activeSelectionContext?: {
    selectedText?: string;
    sourceUtteranceIds: string[];
  };
  /**
   * Exact user-authored phrases parked from earlier large exploratory turns.
   * These are optional memory anchors only: not candidates, not tasks, not
   * priorities, and never permission to create structure.
   */
  openThreads?: OpenThreadContext[];
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
  /**
   * Code-derived, read-only map anchors for map-aware questioning (Goal 4).
   * Present when the map has current cards. The model may use these to anchor a
   * question to existing cards; it never authorizes map mutation or structure
   * proposals.
   */
  mapQuestionContext?: MapQuestionAnchor[];
  /**
   * User-selected read-only focus from the UI: yellow context-selected cards
   * and/or selected draft text. This should steer questions, but it is never
   * Source Bank evidence and never permission to mutate the map or draft.
   */
  selectedFocus?: SelectedFocusContext;
  /**
   * The coach's previous question/clarify the user is now responding to (Goal 5),
   * so the model advances instead of re-asking an answered question.
   */
  lastCoachQuestion?: { text: string; stance?: QuestionStance };
  /**
   * True when the latest user turn reads as a substantive answer to
   * {@link lastCoachQuestion} (not stuck, not a command). Advisory: it nudges the
   * model to move forward rather than re-deepen the same concept.
   */
  userAnsweredLastQuestion?: boolean;
  /**
   * Set when the user explicitly chose the coach's next move from the Under the
   * Hood panel. Highest-priority steering: the prompt forces the corresponding
   * mode this turn (a forced mirror still passes the validator, and falls back to
   * an honest "not enough of your words yet" question when nothing is groundable).
   */
  forcedMode?: UserRequestedMode;
}

/** Sync in tests, async when wired to the real backend. */
export type MockLLM = (ctx: LLMContext) => LLMTurn | Promise<LLMTurn>;
