/**
 * Under the hood - the translation layer for the read-only "what I'm considering"
 * inspector rail.
 *
 * This turns the machine-readable state the controller already holds (candidates,
 * per-candidate readiness, the active elicitation / pending command, draft
 * declarations) into ONE calm, user-facing `UnderstandingSnapshot` per turn. It is
 * pure observability: nothing here is on the user's map, and the panel that renders
 * it emits ZERO map commands.
 *
 * Hard rules (same spirit as trace.ts - the reviewer enforces the UI side):
 *   - No model-generated prose ever reaches the snapshot. Idea labels come ONLY
 *     from the user's OWN source utterances (never `candidate.gist`, the AI's
 *     paraphrase). Waiting-for / safety-check copy comes only from the catalogs
 *     below, plus at most the user's own phrases.
 *   - `out.text`, mirror claim text, `candidate.gist`, and free-form
 *     `suppressionDetail` are never surfaced.
 *   - "The system held back" is never worded as "the user was wrong": held checks
 *     use system-subject copy and a calm `held` state.
 *   - Internal candidate ids are carried only as React keys, never rendered.
 */

import type { MindmapConfig } from "./config";
import type { PendingMapCommand, SuppressionReason, TurnOutput } from "./controller";
import type { DraftDeclaration, DraftDeclarationKind } from "./draft-declarations";
import { cardRef, type SourceBank } from "./store";
import { deriveTraceEvent, type TraceEvent } from "./trace";
import type {
  CandidateTarget,
  CandidateThought,
  ReadinessSignal,
  SourceSpan,
  SourceUtterance,
} from "./types";

/** The fixed thesis banner the rail displays. Never model-generated. */
export const THESIS_BANNER =
  "Nothing here is on your map. This is what I'm considering - you decide what becomes yours, in your words.";

/**
 * Where a tracked idea sits on the road to a reflection. User-facing meaning:
 *   too_early          - not enough of your wording has settled yet
 *   needs_your_wording - I'd have to import words that aren't yours
 *   needs_relationship - you've named a topic but not how it relates
 *   ready              - ready to reflect, if you want
 */
export type IdeaReadinessStatus =
  | "too_early"
  | "needs_your_wording"
  | "needs_relationship"
  | "ready";

export interface IdeaMeters {
  /** sourceDensity - repeated, weighted grounding in your own words. */
  grounded: number;
  /** 1 - unsupportedRisk - how much of it is already in your wording. */
  specific: number;
  /** relationClarity - whether you've given language for a relationship. */
  related: number;
}

export interface TrackedIdea {
  /** Internal candidate id - a React key only, never rendered. */
  id: string;
  /** Short label built ONLY from the user's own source phrases. */
  label: string;
  target: CandidateTarget;
  status: IdeaReadinessStatus;
  meters: IdeaMeters;
  /** Pure "idea" candidates have no relationship by design - hide that meter. */
  showRelated: boolean;
}

export type SafetyCheckState = "ok" | "info" | "held";

export interface SafetyCheck {
  id: string;
  label: string;
  state: SafetyCheckState;
}

export interface DraftAnchor {
  /** Shortened for display. */
  label: string;
  /** The user's exact draft phrase - passed back to highlight the draft span. */
  anchor: string;
  kind: DraftDeclarationKind;
}

export type UnderhoodEventKind =
  | "command_detected"
  | "map_write_guard"
  | "reference_checked"
  | "mirror_attempted"
  | "mirror_blocked"
  | "readiness_changed"
  | "idea_tracked"
  | "draft_anchor_seen"
  | "duplicate_avoided"
  | "question_chosen";

export type UnderhoodEventState = "passed" | "held" | "watching" | "chosen";

export interface UnderhoodEvent {
  id: string;
  kind: UnderhoodEventKind;
  title: string;
  detail: string;
  /** Optional user/draft wording or safe map refs only. Never model prose. */
  evidence?: string;
  state: UnderhoodEventState;
  stateLabel: string;
}

export interface UnderstandingSnapshot {
  /** The single latest decision, reusing the Coach Trace derive layer. */
  latest: TraceEvent;
  /** Turn-specific, evidence-backed events that actually mattered this turn. */
  activeEvents: UnderhoodEvent[];
  /** Ideas the AI is tracking, most-ready first. Labels are user words only. */
  trackedIdeas: TrackedIdea[];
  /** What the AI is waiting on from the user, if anything. */
  waitingFor?: string;
  /** Calm, system-subject notes about what stayed safe this turn. */
  safetyChecks: SafetyCheck[];
  /** Draft ideas the AI is aware of; clicking highlights the draft span. */
  draftAnchors: DraftAnchor[];
  /** Fixed thesis banner. */
  banner: string;
}

export interface UnderstandingInputs {
  out: TurnOutput;
  candidates: CandidateThought[];
  readiness: ReadinessSignal[];
  /** Only `.get` is used - resolving evidence ids to the user's own text. */
  bank: Pick<SourceBank, "get">;
  draftDeclarations: DraftDeclaration[];
  clarifyTarget?: SourceSpan;
  activeElicitation?: {
    kind: "carry_forward" | "clarify_after_failed_mirror" | "sparse_map_next_card";
    targetPhrase?: string;
  };
  pendingMapCommand?: PendingMapCommand;
  config: MindmapConfig;
}

// ---------------------------------------------------------------------------
// User-word helpers
// ---------------------------------------------------------------------------

function shorten(text: string, max: number): string {
  const compact = text.trim().replace(/\s+/g, " ");
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3).trim()}...`;
}

function addEvent(
  events: UnderhoodEvent[],
  event: UnderhoodEvent,
  seen: Set<string>,
): void {
  if (seen.has(event.id)) return;
  seen.add(event.id);
  events.push(event);
}

function firstUserEvidence(ids: string[] | undefined, bank: Pick<SourceBank, "get">): string | undefined {
  const text = ids
    ?.map((id) => bank.get(id))
    .filter((u): u is SourceUtterance => Boolean(u))
    .map((u) => u.text.trim())
    .find(Boolean);
  return text ? shorten(text, 82) : undefined;
}

/**
 * Display-only: strip a leading coaching/command scaffold that introduces the
 * user's actual wording with a colon ("Please help me carry forward the main
 * idea: control means ..." -> "control means ..."). This NEVER mutates the Source
 * Bank, validation, or provenance — it only cleans the label shown in the
 * read-only panel. Kept narrow: it strips only when the pre-colon lead reads as a
 * carry-forward / card-making request, so ordinary content with a colon
 * ("control means: X") is untouched.
 */
function stripLabelLeadIn(text: string): string {
  const trimmed = text.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx <= 0 || colonIdx > 60) return trimmed;
  const lead = trimmed.slice(0, colonIdx).toLowerCase();
  const body = trimmed.slice(colonIdx + 1).trim();
  if (!body) return trimmed;
  const isScaffold =
    /\bcarry\b[\s\S]*\bforward\b/.test(lead) ||
    /\bmain\s+idea\b/.test(lead) ||
    /\b(?:make|turn|create|add|put|drop)\b[\s\S]*\b(?:card|map|idea|point|this|it)\b/.test(lead);
  return isScaffold ? body : trimmed;
}

/**
 * A short label for a tracked candidate, drawn ONLY from the user's own source
 * utterances (never the AI's `gist`). We prefer the shortest non-command
 * evidence phrase - the most label-like piece of the user's wording - after
 * stripping any display-only command/coaching lead-in.
 */
function ideaLabel(
  candidate: CandidateThought,
  bank: Pick<SourceBank, "get">,
): string | undefined {
  const texts = candidate.evidenceUtteranceIds
    .map((id) => bank.get(id))
    .filter((u): u is SourceUtterance => Boolean(u))
    .filter((u) => !u.commandOnly)
    .map((u) => stripLabelLeadIn(u.text))
    .filter((text) => text.length > 0);
  if (texts.length === 0) return undefined;
  texts.sort((a, b) => a.length - b.length);
  return shorten(texts[0], 48);
}

// ---------------------------------------------------------------------------
// Readiness -> status (re-derived from meters + config, not from prose)
// ---------------------------------------------------------------------------

function ideaStatus(signal: ReadinessSignal, cfg: MindmapConfig): IdeaReadinessStatus {
  if (signal.decision === "attempt_mirror") return "ready";
  if (signal.reason.includes("non-user words")) return "needs_your_wording";
  if (signal.reason.includes("relationship") || signal.reason.includes("containment")) {
    return "needs_relationship";
  }
  if (signal.reason.includes("grounding")) return "too_early";
  const r = cfg.readiness;
  // Mirror readiness.ts's deficiency ordering (spontaneous rule / density /
  // clarity / risk) so the label names the same weak signal the gate saw.
  const densityOk = signal.sourceDensity >= r.sourceDensityMin;
  const clarityOk = signal.relationClarity >= r.relationClarityMin;
  const riskOk = signal.unsupportedRisk <= r.unsupportedRiskMax;
  if (!densityOk) return "too_early";
  if (!clarityOk) return "needs_relationship";
  if (!riskOk) return "needs_your_wording";
  return "too_early";
}

const STATUS_ORDER: Record<IdeaReadinessStatus, number> = {
  ready: 0,
  needs_your_wording: 1,
  needs_relationship: 2,
  too_early: 3,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0));
}

function buildTrackedIdeas(input: UnderstandingInputs): TrackedIdea[] {
  const readinessById = new Map(input.readiness.map((s) => [s.candidateId, s]));
  const ideas: TrackedIdea[] = [];
  for (const candidate of input.candidates) {
    const signal = readinessById.get(candidate.id);
    if (!signal) continue;
    const label = ideaLabel(candidate, input.bank);
    // No user wording to ground a label -> don't invent one; skip it.
    if (!label) continue;
    ideas.push({
      id: candidate.id,
      label,
      target: candidate.target,
      status: ideaStatus(signal, input.config),
      meters: {
        grounded: clamp01(signal.sourceDensity),
        specific: clamp01(1 - signal.unsupportedRisk),
        related: clamp01(signal.relationClarity),
      },
      showRelated: candidate.target !== "idea",
    });
  }
  ideas.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return b.meters.grounded - a.meters.grounded;
  });
  return ideas.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Waiting-for (catalog copy + the user's own phrases only)
// ---------------------------------------------------------------------------

const PENDING_WAIT: Record<PendingMapCommand["kind"], string> = {
  reference_confirmation: "your go-ahead on which existing card you meant",
  connection_label: "the words you'd put on that connection",
  relationship_confirmation: "your okay on the relationship wording I heard",
  duplicate_connection_confirmation:
    "whether to add another connection between those two cards",
};

function quotedUserPhrase(phrase: string | undefined): string | undefined {
  const trimmed = phrase?.trim();
  if (!trimmed) return undefined;
  return `"${shorten(trimmed, 60)}"`;
}

function describeWaitingFor(input: UnderstandingInputs): string | undefined {
  if (input.pendingMapCommand) {
    return PENDING_WAIT[input.pendingMapCommand.kind];
  }
  const elicitation = input.activeElicitation;
  if (elicitation) {
    const phrase = quotedUserPhrase(elicitation.targetPhrase);
    switch (elicitation.kind) {
      case "carry_forward":
        return phrase
          ? `the exact words you'd carry forward from ${phrase}`
          : "the exact words you'd carry forward";
      case "sparse_map_next_card":
        return "the exact words you want on your next card";
      case "clarify_after_failed_mirror":
        return phrase
          ? `a bit more of your own wording on ${phrase}`
          : "a bit more of your own wording on that idea";
    }
  }
  const clarifyPhrase = quotedUserPhrase(input.clarifyTarget?.userPhrase);
  if (clarifyPhrase) return `a bit more of your own wording on ${clarifyPhrase}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Safety checks (system-subject, calm; held is not "you were wrong")
// ---------------------------------------------------------------------------

const SUPPRESSION_SAFETY: Partial<
  Record<SuppressionReason, { label: string; state: SafetyCheckState }>
> = {
  validation_failed: {
    label: "Held a reflection back - the wording had drifted from yours.",
    state: "held",
  },
  not_ready: {
    label: "Waiting for more of your own wording before I reflect anything.",
    state: "held",
  },
  capture_loop: {
    label: "Changed the question instead of repeating the same one.",
    state: "info",
  },
  already_on_map: {
    label: "Didn't re-offer something that's already a card.",
    state: "ok",
  },
  large_exploratory_turn: {
    label: "Helped you pick one piece rather than harvesting the whole dump.",
    state: "info",
  },
};

function buildSafetyChecks(input: UnderstandingInputs): SafetyCheck[] {
  const checks: SafetyCheck[] = [
    {
      id: "no-unasked-writes",
      label: "I won't change your map unless you ask me to.",
      state: "ok",
    },
  ];
  const { out } = input;
  if (out.mapCommands && out.mapCommands.length > 0) {
    checks.push({
      id: "followed-instruction",
      label: "Made the map change you asked for - nothing else.",
      state: "info",
    });
  }
  if (out.commandConfirmation) {
    checks.push({
      id: "confirm-first",
      label: "Checking with you before touching the map.",
      state: "info",
    });
  }
  const suppression = out.suppressionReason
    ? SUPPRESSION_SAFETY[out.suppressionReason]
    : undefined;
  if (suppression) {
    checks.push({
      id: `suppression-${out.suppressionReason}`,
      label: suppression.label,
      state: suppression.state,
    });
  }
  return checks;
}

// ---------------------------------------------------------------------------
// Draft anchors (the user's own draft phrases)
// ---------------------------------------------------------------------------

function buildDraftAnchors(declarations: DraftDeclaration[]): DraftAnchor[] {
  const seen = new Set<string>();
  const anchors: DraftAnchor[] = [];
  for (const declaration of declarations) {
    const anchor = declaration.userPhrase.trim();
    if (!anchor || seen.has(anchor)) continue;
    seen.add(anchor);
    anchors.push({
      label: shorten(declaration.text || anchor, 72),
      anchor,
      kind: declaration.kind,
    });
    if (anchors.length >= 4) break;
  }
  return anchors;
}

// ---------------------------------------------------------------------------
// Active events (eventful liveness, not a fixed every-turn checklist)
// ---------------------------------------------------------------------------

function commandEvidence(
  command: NonNullable<TurnOutput["mapCommands"]>[number],
  bank: Pick<SourceBank, "get">,
): string | undefined {
  if (command.kind === "create_card") return firstUserEvidence(command.sourceUtteranceIds, bank);
  if (command.kind === "nest_card") {
    const child = "id" in command.child
      ? cardRef(command.child.id)
      : firstUserEvidence(command.child.sourceUtteranceIds, bank);
    return child && command.parentId ? `${child} under ${cardRef(command.parentId)}` : child;
  }
  const source = "id" in command.source
    ? cardRef(command.source.id)
    : firstUserEvidence(command.source.sourceUtteranceIds, bank);
  const target = "id" in command.target
    ? cardRef(command.target.id)
    : firstUserEvidence(command.target.sourceUtteranceIds, bank);
  if (source && target) return `${source} -> ${target}`;
  return source ?? target;
}

function commandSummary(
  commands: NonNullable<TurnOutput["mapCommands"]>,
  bank: Pick<SourceBank, "get">,
): string | undefined {
  const evidence = commands.map((command) => commandEvidence(command, bank)).find(Boolean);
  if (!evidence) return undefined;
  return commands.length === 1 ? evidence : `${evidence} (+${commands.length - 1} more)`;
}

function pendingKindLabel(kind: PendingMapCommand["kind"]): string {
  switch (kind) {
    case "reference_confirmation":
      return "I checked the card reference before changing the map.";
    case "connection_label":
      return "I paused to ask what words belong on the connection.";
    case "relationship_confirmation":
      return "I checked the relationship wording before drawing it.";
    case "duplicate_connection_confirmation":
      return "Those cards already connect, so I checked before adding another line.";
  }
}

function validationEvidence(out: TurnOutput): string | undefined {
  const phrase = out.validationDebug
    ?.flatMap((claim) => claim.sourceSpans)
    .map((span) => span.userPhrase.trim())
    .find(Boolean);
  return phrase ? shorten(phrase, 82) : undefined;
}

function buildActiveEvents(
  input: UnderstandingInputs,
  trackedIdeas: TrackedIdea[],
  draftAnchors: DraftAnchor[],
): UnderhoodEvent[] {
  const events: UnderhoodEvent[] = [];
  const seen = new Set<string>();
  const { out } = input;

  if (out.mapCommands && out.mapCommands.length > 0) {
    addEvent(
      events,
      {
        id: "map-command",
        kind: "command_detected",
        title: "Map instruction detected",
        detail: "A direct map instruction took precedence over coaching.",
        evidence: commandSummary(out.mapCommands, input.bank),
        state: "chosen",
        stateLabel: "executed",
      },
      seen,
    );
    addEvent(
      events,
      {
        id: "map-write-guard",
        kind: "map_write_guard",
        title: "Map write limited",
        detail: "Only the accepted requested change was sent to the map.",
        state: "passed",
        stateLabel: "safe",
      },
      seen,
    );
  }

  if (out.commandConfirmation) {
    addEvent(
      events,
      {
        id: `pending-${out.commandConfirmation.kind}`,
        kind:
          out.commandConfirmation.kind === "duplicate_connection_confirmation"
            ? "duplicate_avoided"
            : "reference_checked",
        title:
          out.commandConfirmation.kind === "duplicate_connection_confirmation"
            ? "Existing connection noticed"
            : "Paused before changing the map",
        detail: pendingKindLabel(out.commandConfirmation.kind),
        state: "held",
        stateLabel: "confirm",
      },
      seen,
    );
  }

  const commandReasons = new Set(out.commandDebug?.map((note) => note.reason) ?? []);
  if (
    ["ambiguous_reference", "unresolved_reference", "near_match_pending", "near_match_still_pending"].some((reason) =>
      commandReasons.has(reason),
    )
  ) {
    addEvent(
      events,
      {
        id: "reference-check",
        kind: "reference_checked",
        title: "Card reference needed checking",
        detail: "I did not guess which existing card you meant.",
        state: "held",
        stateLabel: "paused",
      },
      seen,
    );
  }
  if (
    ["duplicate_connection_pending", "duplicate_connection_still_pending", "duplicate_connection_rejected"].some(
      (reason) => commandReasons.has(reason),
    )
  ) {
    addEvent(
      events,
      {
        id: "duplicate-check",
        kind: "duplicate_avoided",
        title: "Duplicate connection checked",
        detail: "The map already had a relationship there, so I did not add another silently.",
        state: "held",
        stateLabel: "checked",
      },
      seen,
    );
  }

  if (out.mode === "mirror" && out.validatedMirror) {
    addEvent(
      events,
      {
        id: "mirror-passed",
        kind: "mirror_attempted",
        title: "Reflection passed grounding",
        detail: "The mirror was close enough to your wording to ask for your confirmation.",
        state: "passed",
        stateLabel: "passed",
      },
      seen,
    );
  }

  if (out.suppressionReason === "validation_failed") {
    addEvent(
      events,
      {
        id: "mirror-attempted",
        kind: "mirror_attempted",
        title: "Reflection attempted",
        detail: "The system tried to mirror, then checked whether the wording stayed grounded.",
        evidence: validationEvidence(out),
        state: "watching",
        stateLabel: "checked",
      },
      seen,
    );
    addEvent(
      events,
      {
        id: "mirror-blocked",
        kind: "mirror_blocked",
        title: "Reflection held back",
        detail: "The draft reflection drifted too far, so the coach asked for clearer wording instead.",
        state: "held",
        stateLabel: "held",
      },
      seen,
    );
  } else if (out.suppressionReason === "mirror_pressure_bridge") {
    const ready = trackedIdeas.find((idea) => idea.status === "ready");
    addEvent(
      events,
      {
        id: "mirror-pressure",
        kind: "readiness_changed",
        title: "Ready to reflect",
        detail: "Enough material had accumulated, so I asked whether to mirror before continuing.",
        evidence: ready?.label,
        state: "chosen",
        stateLabel: "ready",
      },
      seen,
    );
  } else if (out.suppressionReason === "draft_salience_bridge") {
    addEvent(
      events,
      {
        id: "draft-salience",
        kind: "draft_anchor_seen",
        title: "Draft-backed idea noticed",
        detail: "A main idea from your draft or repeated wording was strong enough to bring toward the map.",
        evidence: draftAnchors[0]?.label,
        state: "chosen",
        stateLabel: "noticed",
      },
      seen,
    );
  } else if (out.suppressionReason === "not_ready") {
    addEvent(
      events,
      {
        id: "not-ready",
        kind: "readiness_changed",
        title: "Not ready to reflect yet",
        detail: "The system stayed with questioning because the available wording was still too thin.",
        evidence: trackedIdeas[0]?.label,
        state: "watching",
        stateLabel: "forming",
      },
      seen,
    );
  } else if (out.suppressionReason === "large_exploratory_turn") {
    addEvent(
      events,
      {
        id: "large-turn",
        kind: "question_chosen",
        title: "Large turn narrowed",
        detail: "Rather than harvesting the whole turn, the coach asked you to choose one piece.",
        state: "chosen",
        stateLabel: "narrowed",
      },
      seen,
    );
  } else if (out.suppressionReason === "already_on_map") {
    addEvent(
      events,
      {
        id: "already-on-map",
        kind: "map_write_guard",
        title: "Duplicate card avoided",
        detail: "The idea already appeared on the map, so it was not offered again.",
        state: "passed",
        stateLabel: "safe",
      },
      seen,
    );
  }

  if (events.length === 0) {
    addEvent(
      events,
      {
        id: "question-chosen",
        kind: "question_chosen",
        title: out.mode === "clarify" ? "Clarifying one piece" : "Question chosen",
        detail: out.mode === "clarify"
          ? "The coach asked for a smaller piece instead of guessing."
          : "The coach stayed in conversation rather than changing the map.",
        state: "chosen",
        stateLabel: out.questionStance ?? out.mode,
      },
      seen,
    );
  }

  return events.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build the read-only understanding snapshot for a resolved turn. Pure: it only
 * READS the passed-in state and never mutates it or the map. Safe to call once
 * per turn from the controller's finish() choke point.
 */
export function buildUnderstanding(input: UnderstandingInputs): UnderstandingSnapshot {
  const trackedIdeas = buildTrackedIdeas(input);
  const draftAnchors = buildDraftAnchors(input.draftDeclarations);
  return {
    latest: deriveTraceEvent(input.out, "latest"),
    activeEvents: buildActiveEvents(input, trackedIdeas, draftAnchors),
    trackedIdeas,
    waitingFor: describeWaitingFor(input),
    safetyChecks: buildSafetyChecks(input),
    draftAnchors,
    banner: THESIS_BANNER,
  };
}
