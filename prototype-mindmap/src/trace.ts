/**
 * Coach Trace — the derive layer for the user-facing transparency panel.
 *
 * This turns the machine-readable trail the controller already returns on every
 * `TurnOutput` into ONE calm, human-readable `TraceEvent` per turn. It is the
 * seam the UI (Coder 2) builds against: the UI only ever renders the strings on
 * a `TraceEvent`, never a raw controller field.
 *
 * Hard rules baked in here (the reviewer enforces the UI side):
 *   - No model-generated prose ever reaches a TraceEvent. Titles/explanations
 *     come only from the catalogs below; details are catalog copy plus, at most,
 *     numeric scores and the user's OWN phrases. `out.text`, mirror claim text,
 *     and free-form `suppressionDetail` are never surfaced.
 *   - The internal `reason` key is carried for telemetry/technical disclosure
 *     only; the UI must not render it in the default view.
 *   - "The system held back" is never styled or worded as "the user was wrong":
 *     held-back events use level "held" and system-subject copy.
 *
 * Completeness is enforced two ways:
 *   - Typed unions (SuppressionReason, QuestionStance, PendingMapCommand["kind"])
 *     are keyed with `Record<Union, …>`, so a new union member fails compilation
 *     until it is given a label here.
 *   - The 40 free-string command reasons are listed in KNOWN_COMMAND_REASONS and
 *     locked by trace.test.ts. If the controller grows a new command reason,
 *     re-harvest it (grep `reason:` in controller.ts) and add it below.
 */

import type {
  CommandDebugNote,
  PendingMapCommand,
  SuppressionReason,
  TurnOutput,
} from "./controller";
import type { QuestionStance } from "./llm-contract";

export type TraceLevel = "quiet" | "notice" | "held";

export interface TraceEvent {
  id: string;
  turnId: string;
  /** Internal key (a controller reason / "executed" / "mirror" / "stance:…"). Never shown by default. */
  reason: string;
  level: TraceLevel;
  /** Semantic icon key — the UI maps it to a glyph (e.g. check, pause, help, link, compass, chat). */
  icon: string;
  title: string;
  explanation: string;
  detail?: string;
  technical?: Record<string, unknown>;
}

interface CatalogEntry {
  level: TraceLevel;
  icon: string;
  title: string;
  explanation: string;
}

// ---------------------------------------------------------------------------
// Catalogs — the only place user-facing copy lives.
// ---------------------------------------------------------------------------

/** Mirror-pacing / mirror-gate outcomes. Compile-enforced over the union. */
const SUPPRESSION_CATALOG: Record<SuppressionReason, CatalogEntry> = {
  validation_failed: {
    level: "held",
    icon: "pause",
    title: "I held back a reflection",
    explanation: "I started to reflect, but the wording drifted too far from yours.",
  },
  not_ready: {
    level: "held",
    icon: "sprout",
    title: "Not enough settled yet",
    explanation:
      "I heard an idea forming, but there wasn't enough of your own wording to reflect it back safely.",
  },
  cooldown: {
    level: "quiet",
    icon: "pace",
    title: "Keeping a steady pace",
    explanation: "I could have reflected, but it was soon after the last one, so I asked instead.",
  },
  batch_preference: {
    level: "quiet",
    icon: "pace",
    title: "Gathering a few first",
    explanation: "I'm waiting until a couple of ideas are ready to reflect them together.",
  },
  already_on_map: {
    level: "quiet",
    icon: "pin",
    title: "Already on the map",
    explanation: "What I'd reflect is already a card, so I didn't repeat it.",
  },
  large_exploratory_turn: {
    level: "notice",
    icon: "compass",
    title: "Helping you choose",
    explanation:
      "That was a big, exploratory turn, so I helped you pick one piece rather than harvest it all.",
  },
  capture_loop: {
    level: "notice",
    icon: "refresh",
    title: "Trying a different angle",
    explanation: "We circled the same wording, so I changed the question instead of repeating it.",
  },
  missing_mirror_payload: {
    level: "quiet",
    icon: "chat",
    title: "Asked a question instead",
    explanation: "I didn't have a clean reflection ready, so I asked something instead.",
  },
  // Reached only in the rare case a command hand-back carries no mapCommands;
  // the normal executed path is caught earlier and uses the "executed" story.
  command_precedence: {
    level: "notice",
    icon: "check",
    title: "Followed your instruction",
    explanation: "You gave a direct instruction, so I did that and stepped back.",
  },
};

/** Plain-question stance — always ambient. Compile-enforced over the union. */
const STANCE_CATALOG: Record<QuestionStance, CatalogEntry> = {
  settle: {
    level: "quiet",
    icon: "chat",
    title: "Slowing down",
    explanation: "Taking it gently, looking for the one piece you feel surest about.",
  },
  narrow: {
    level: "quiet",
    icon: "chat",
    title: "Narrowing in",
    explanation: "Zeroing in on one part rather than the whole thing.",
  },
  deepen: {
    level: "quiet",
    icon: "chat",
    title: "Going deeper on one idea",
    explanation: "Looking more closely at what you just said, rather than moving on.",
  },
  organize: {
    level: "quiet",
    icon: "chat",
    title: "Looking at how things relate",
    explanation: "Turning toward how your ideas connect, now there's enough to work with.",
  },
  challenge: {
    level: "quiet",
    icon: "chat",
    title: "Testing an assumption",
    explanation: "Gently pushing on a claim you seem ready to examine.",
  },
};

/** A command is waiting on the user. Compile-enforced over the confirmation kinds. */
const PENDING_CATALOG: Record<PendingMapCommand["kind"], CatalogEntry> = {
  reference_confirmation: {
    level: "notice",
    icon: "help",
    title: "Checked which card you meant",
    explanation: "Your reference was close to an existing card, so I asked before changing the map.",
  },
  connection_label: {
    level: "notice",
    icon: "link",
    title: "Asked for the relationship wording",
    explanation: "Before drawing that connection, I asked for the words you'd put on it.",
  },
  relationship_confirmation: {
    level: "notice",
    icon: "link",
    title: "Confirming the relationship",
    explanation: "I offered back the relationship wording I heard, to check I had it right.",
  },
  duplicate_connection_confirmation: {
    level: "notice",
    icon: "link",
    title: "Spotted an existing connection",
    explanation: "Those two cards are already connected, so I checked before adding another.",
  },
};

/** Story keys for executed / mirror / clarify and the grouped command reasons. */
const STORY_CATALOG: Record<string, CatalogEntry> = {
  executed: {
    level: "notice",
    icon: "check",
    title: "Followed your instruction",
    explanation: "You gave a direct map instruction, so I did that and didn't reflect on the same words.",
  },
  mirror: {
    level: "notice",
    icon: "reflect",
    title: "Reflected your words back",
    explanation: "Enough of your own wording had settled, so I mirrored the structure for you to confirm.",
  },
  clarify: {
    level: "notice",
    icon: "help",
    title: "Asked you to clarify",
    explanation: "Something didn't quite land, so I asked about one specific part.",
  },
  card_wording: {
    level: "notice",
    icon: "pencil",
    title: "Asked what to put on the card",
    explanation: "That sounded like a card, but the exact wording wasn't clear yet, so I asked.",
  },
  reference_unclear: {
    level: "notice",
    icon: "help",
    title: "Checked which card you meant",
    explanation: "I couldn't tell which existing card you meant, so I asked before changing anything.",
  },
  command_clarify: {
    level: "notice",
    icon: "help",
    title: "Clarified the instruction",
    explanation: "The command could go two ways, so I checked what you meant.",
  },
  cancelled: {
    level: "quiet",
    icon: "x",
    title: "Left it as it was",
    explanation: "You called that off, so I didn't change the map.",
  },
  rejected: {
    level: "notice",
    icon: "help",
    title: "Waiting for the right one",
    explanation: "That wasn't quite it, so I asked again rather than guessing.",
  },
  coverage: {
    level: "notice",
    icon: "compass",
    title: "Offered some directions",
    explanation:
      "You asked for help choosing, so I offered grounded options instead of expecting you to already know.",
  },
  child_placement: {
    level: "notice",
    icon: "pencil",
    title: "Asked for the smaller card's words",
    explanation: "You wanted a card underneath, so I asked what exact words go on it.",
  },
  label_skipped: {
    level: "quiet",
    icon: "link",
    title: "Left the connection unlabeled",
    explanation: "You didn't want a label, so I connected the cards without one.",
  },
  focus_one: {
    level: "quiet",
    icon: "target",
    title: "Staying with one piece",
    explanation: "There was a lot there, so I kept us on a single part of it.",
  },
};

/**
 * Every free-string command reason the controller can emit (harvested from
 * controller.ts). Each maps to a STORY_CATALOG key. Locked by trace.test.ts —
 * a new controller command reason must be added here and mapped, or the test
 * fails. Confirmed/completed/corrected reasons ride along with an executed
 * command (caught by the mapCommands branch), so they map to "executed".
 */
const COMMAND_STORY: Record<string, keyof typeof STORY_CATALOG> = {
  // card-wording blocks
  referential_card_text: "card_wording",
  vague_anaphoric_card_text: "card_wording",
  blocked_interpretation: "card_wording",
  missing_card_text: "card_wording",
  not_current_turn_span: "card_wording",
  stale_source_id: "card_wording",
  // reference resolution
  ambiguous_reference: "reference_unclear",
  unresolved_reference: "reference_unclear",
  ungrounded_existing_endpoint: "reference_unclear",
  near_match_pending: "reference_unclear",
  near_match_still_pending: "reference_unclear",
  // command clarification
  command_clarification: "command_clarify",
  command_uncertainty: "command_clarify",
  // labels
  connection_label_pending: "command_clarify",
  connection_label_still_pending: "command_clarify",
  missing_connection_label: "command_clarify",
  connection_label_skipped: "label_skipped",
  // relationships / duplicates (pending forms)
  relationship_confirmation_pending: "command_clarify",
  relationship_corrected: "command_clarify",
  relationship_correction_still_pending: "command_clarify",
  relationship_still_pending: "command_clarify",
  duplicate_connection_pending: "command_clarify",
  duplicate_connection_still_pending: "command_clarify",
  // cancels / rejects
  near_match_cancelled: "cancelled",
  connection_label_cancelled: "cancelled",
  relationship_cancelled: "cancelled",
  duplicate_connection_rejected: "cancelled",
  near_match_rejected: "rejected",
  relationship_rejected: "rejected",
  // executed side effects
  near_match_confirmed: "executed",
  near_match_corrected: "executed",
  connection_label_completed: "executed",
  relationship_confirmed: "executed",
  duplicate_connection_confirmed: "executed",
  explicit_ref_nest: "executed",
  exact_text_multisegment: "executed",
  // child placement
  pending_child_placement: "child_placement",
  // coverage / focus-help (added by the remote coverage pass)
  coverage_intent: "coverage",
  coverage_focus_hold: "coverage",
  // large-turn narrowing
  large_turn_candidate_filter: "focus_one",
};

export const KNOWN_COMMAND_REASONS: readonly string[] = Object.keys(COMMAND_STORY);

// ---------------------------------------------------------------------------
// Derive
// ---------------------------------------------------------------------------

function firstKnownCommandReason(notes: CommandDebugNote[] | undefined): string | undefined {
  return notes?.map((note) => note.reason).find((reason) => reason in COMMAND_STORY);
}

/** Numeric grounding score behind a failed mirror — numbers only, never claim text. */
function groundingDetail(out: TurnOutput): { detail?: string; technical?: Record<string, unknown> } {
  const check = out.validationDebug
    ?.flatMap((claim) => claim.checks)
    .find((c) => !c.ok && Number.isFinite(c.score) && Number.isFinite(c.threshold));
  if (!check) return {};
  return {
    detail: `The draft reflection didn't match your source text closely enough. Grounding ${check.score.toFixed(
      2,
    )}, needed ${check.threshold.toFixed(2)}.`,
    technical: { check: check.check, score: check.score, threshold: check.threshold },
  };
}

function resolveEntry(key: string, out: TurnOutput): { entry: CatalogEntry; storyKey: string } {
  if (key.startsWith("pending:")) {
    const kind = key.slice("pending:".length) as PendingMapCommand["kind"];
    return { entry: PENDING_CATALOG[kind], storyKey: key };
  }
  if (key.startsWith("stance:")) {
    const stance = key.slice("stance:".length) as QuestionStance;
    return { entry: STANCE_CATALOG[stance] ?? STANCE_CATALOG.deepen, storyKey: key };
  }
  if (key in SUPPRESSION_CATALOG) {
    return { entry: SUPPRESSION_CATALOG[key as SuppressionReason], storyKey: key };
  }
  if (key in STORY_CATALOG) {
    return { entry: STORY_CATALOG[key], storyKey: key };
  }
  const story = COMMAND_STORY[key];
  if (story) return { entry: STORY_CATALOG[story], storyKey: story };
  // Unknown reason: degrade to the current stance rather than inventing copy.
  const stance = out.questionStance ?? "deepen";
  return { entry: STANCE_CATALOG[stance], storyKey: `stance:${stance}` };
}

/**
 * The single primary decision for this turn, most-informative first. One
 * TraceEvent per turn keeps the panel calm.
 */
function dominantReason(out: TurnOutput): string {
  if (out.mapCommands && out.mapCommands.length > 0) return "executed";
  if (out.commandConfirmation) return `pending:${out.commandConfirmation.kind}`;
  if (out.mode === "mirror") return "mirror";
  if (out.suppressionReason) return out.suppressionReason;
  const command = firstKnownCommandReason(out.commandDebug);
  if (command) return command;
  if (out.mode === "clarify") return "clarify";
  return `stance:${out.questionStance ?? "deepen"}`;
}

/**
 * Derive the calm, user-facing trace event for a resolved turn. Pure: safe to
 * call once per turn and append to a log.
 */
export function deriveTraceEvent(out: TurnOutput, turnId: string): TraceEvent {
  const reason = dominantReason(out);
  const { entry } = resolveEntry(reason, out);

  let detail: string | undefined;
  let technical: Record<string, unknown> = { reason };
  if (out.suppressionReason) technical.suppressionReason = out.suppressionReason;

  if (reason === "validation_failed") {
    const grounding = groundingDetail(out);
    detail = grounding.detail;
    if (grounding.technical) technical = { ...technical, ...grounding.technical };
  }

  return {
    id: `trace-${turnId}`,
    turnId,
    reason,
    level: entry.level,
    icon: entry.icon,
    title: entry.title,
    explanation: entry.explanation,
    ...(detail ? { detail } : {}),
    technical,
  };
}
