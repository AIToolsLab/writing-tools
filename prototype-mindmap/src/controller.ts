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
import { detectDraftDeclarations, type DraftDeclaration } from "./draft-declarations";
import type { LLMContext, LLMMapContext, LLMTurn, MapCommand, MockLLM, QuestionStance } from "./llm-contract";
import { contentTokens, normalize } from "./normalize";
import { evaluateReadiness, readyCandidates } from "./readiness";
import { detectSignals } from "./signals";
import { CandidateStore, SourceBank, cardRef } from "./store";
import { detectTurnShape } from "./turn-shape";
import type {
  ClaimValidation,
  MirrorReflection,
  RelationSignal,
  SourceSpan,
  SourceUtterance,
  UtteranceOrigin,
} from "./types";
import { validateMirror } from "./validator";

export type ControllerMode = "question" | "mirror" | "clarify";
export type SuppressionReason =
  | "cooldown"
  | "missing_mirror_payload"
  | "not_ready"
  | "batch_preference"
  | "already_on_map"
  | "large_exploratory_turn"
  | "command_precedence"
  | "validation_failed";

export type AcceptedMapCommandCardRef =
  | { id: string }
  | { text: string; sourceUtteranceIds: string[] };

export type AcceptedMapCommand =
  | {
      kind: "create_card";
      text: string;
      sourceUtteranceIds: string[];
    }
  | {
      kind: "nest_card";
      child: AcceptedMapCommandCardRef;
      parentId: string;
    }
  | {
      kind: "connect_cards";
      source: AcceptedMapCommandCardRef;
      target: AcceptedMapCommandCardRef;
      labelText?: string;
      labelSourceUtteranceIds?: string[];
    };

export interface PendingMapCommandConfirmation {
  prompt: string;
  command: AcceptedMapCommand;
  debug: string;
}

export interface CommandDebugNote {
  reason: string;
  detail: string;
}

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
  pendingMapCommand?: PendingMapCommandConfirmation;
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

function isRedundantDraftDeclarationQuestion(text: string, config: MindmapConfig): boolean {
  const trimmed = text.trim();
  if (!trimmed.endsWith("?")) return false;
  if (!new RegExp(config.draftRedundancy.declaredFocusPattern, "i").test(trimmed)) return false;
  if (!new RegExp(config.draftRedundancy.restateQuestionPattern, "i").test(trimmed)) return false;
  if (new RegExp(config.draftRedundancy.deepenQuestionPattern, "i").test(trimmed)) return false;
  return true;
}

function shortenDraftDeclaration(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  return compact.length <= 90 ? compact : `${compact.slice(0, 87).trim()}...`;
}

function targetedDraftDeclarationQuestion(declarations: DraftDeclaration[]): Partial<TurnOutput> | undefined {
  const declaration = declarations[0];
  if (!declaration) return undefined;
  const quote = shortenDraftDeclaration(declaration.text);
  return {
    mode: "question",
    text: `What tension or consequence in "${quote}" feels most important to examine next?`,
    questionAnchor: declaration.userPhrase,
    questionStance: "deepen",
  };
}

function intersects(a: Iterable<string>, b: ReadonlySet<string>): boolean {
  for (const item of a) {
    if (b.has(item)) return true;
  }
  return false;
}

function isReferentialCardText(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return (
    /^(my|that|this|it|the|those|these)\s+/.test(lower) &&
    /\b(main point|point|thing|idea|part|piece|concept|notion|argument|claim|framework|theme|thread|bit)\b/.test(lower)
  );
}

function isBlockedCreateCardInterpretation(unitText: string, cardText: string): boolean {
  const lower = unitText.toLowerCase();
  const phrase = cardText.trim().toLowerCase();
  const phraseIndex = lower.indexOf(phrase);
  const afterPhrase = phraseIndex >= 0 ? lower.slice(phraseIndex + phrase.length, phraseIndex + phrase.length + 90) : lower;
  const beforePhrase = phraseIndex >= 0 ? lower.slice(Math.max(0, phraseIndex - 90), phraseIndex) : lower;

  if (/\b(maybe|perhaps|possibly|i wonder|i'm wondering|im wondering|i am wondering|not sure|unsure)\b/.test(lower)) {
    return true;
  }

  if (/\b(is|are|was|were|feels?|seems?|matters?|means?|supports?|relates?|connects?|belongs?)\b/.test(afterPhrase)) {
    return true;
  }

  if (/\b(i think|i feel|i guess|i mean|i'm thinking|im thinking|i am thinking)\b/.test(beforePhrase)) {
    return true;
  }

  return false;
}

function isConnectCommandText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\b(?:connect|link|join)\b/.test(lower) ||
    /\b(?:draw|make|create|add|put)\b.{0,80}\b(?:line|connection|link|edge)\b/.test(lower)
  );
}

function currentTurnSourceIdsForPhrase(
  phrase: string | undefined,
  units: SourceUtterance[],
): string[] {
  const trimmed = phrase?.trim();
  if (!trimmed || isReferentialCardText(trimmed)) return [];
  return units.filter((unit) => unit.text.includes(trimmed)).map((unit) => unit.id);
}

/**
 * Resolve a card reference like "#59" (the human-visible ref the AI and user
 * cite) back to an existing card id. The ref is `#` + the id's trailing number,
 * which is globally unique, so a bare "#N" maps to exactly one card.
 */
function resolveCardRefNumber(text: string | undefined, map: LLMMapContext): string | undefined {
  const match = text?.trim().match(/^#?(\d+)$/);
  if (!match) return undefined;
  const wanted = `#${match[1]}`;
  const matches = map.thoughtUnits.filter(
    (unit) => unit.role !== "connection_label" && cardRef(unit.id) === wanted,
  );
  return matches.length === 1 ? matches[0].id : undefined;
}

function resolveExistingCardId(text: string | undefined, map: LLMMapContext): string | undefined {
  const target = normalize(text ?? "");
  if (!target) return undefined;
  const matches = map.thoughtUnits.filter(
    (unit) => unit.role !== "connection_label" && normalize(unit.text) === target,
  );
  return matches.length === 1 ? matches[0].id : undefined;
}

/**
 * Is this mirror claim already a card on the map? A reflection is the placement
 * mechanism — re-offering placed structure is pure noise and risks minting a
 * duplicate card. Deterministic, normalized-exact match; never trust the model
 * to remember what it already mirrored.
 */
function claimAlreadyOnMap(claimText: string, map: LLMMapContext): boolean {
  const target = normalize(claimText);
  if (!target) return false;
  return map.thoughtUnits.some(
    (unit) => unit.role !== "connection_label" && normalize(unit.text) === target,
  );
}

function nearReferenceMatches(text: string | undefined, map: LLMMapContext): Array<{ id: string; text: string }> {
  const target = normalize(text ?? "");
  if (!target) return [];
  const targetTokens = contentTokens(target);
  if (targetTokens.length === 0 || !targetTokens.some((token) => token.length >= 4)) return [];
  return map.thoughtUnits
    .filter((unit) => {
      if (unit.role === "connection_label") return false;
      const unitText = normalize(unit.text);
      if (!unitText || unitText === target) return false;
      const unitTokens = new Set(contentTokens(unitText));
      const tokenSubset = targetTokens.every((token) => unitTokens.has(token));
      return unitText.includes(target) || target.includes(unitText) || tokenSubset;
    })
    .map((unit) => ({ id: unit.id, text: unit.text }));
}

type ResolvedCommandCardRef =
  | { kind: "resolved"; ref: AcceptedMapCommandCardRef }
  | { kind: "near"; requested: string; matches: Array<{ id: string; text: string }> }
  | { kind: "unresolved"; requested: string };

function resolveCommandCardRefDetailed(
  text: string | undefined,
  units: SourceUtterance[],
  map: LLMMapContext,
): ResolvedCommandCardRef {
  const requested = text?.trim() ?? "";
  const refId = resolveCardRefNumber(text, map);
  if (refId) return { kind: "resolved", ref: { id: refId } };
  const existingId = resolveExistingCardId(text, map);
  if (existingId) return { kind: "resolved", ref: { id: existingId } };
  const nearMatches = nearReferenceMatches(text, map);
  if (nearMatches.length > 0) return { kind: "near", requested, matches: nearMatches };
  const sourceUtteranceIds = currentTurnSourceIdsForPhrase(text, units);
  if (sourceUtteranceIds.length === 0 || !requested) return { kind: "unresolved", requested };
  return { kind: "resolved", ref: { text: requested, sourceUtteranceIds } };
}

function cardRefKey(ref: AcceptedMapCommandCardRef): string {
  return "id" in ref ? ref.id : ref.text;
}

function describeCardRef(ref: AcceptedMapCommandCardRef, map: LLMMapContext): string {
  if (!("id" in ref)) return ref.text;
  return map.thoughtUnits.find((unit) => unit.id === ref.id)?.text ?? ref.id;
}

function groundedLabel(command: MapCommand, units: SourceUtterance[]): {
  labelText?: string;
  labelSourceUtteranceIds?: string[];
} {
  const labelText = command.labelText?.trim() || undefined;
  const sourceIds = labelText ? currentTurnSourceIdsForPhrase(labelText, units) : undefined;
  if (!labelText || !sourceIds || sourceIds.length === 0) return {};
  return { labelText, labelSourceUtteranceIds: sourceIds };
}

function acceptedCommandFromNearMatch(
  command: MapCommand,
  units: SourceUtterance[],
  map: LLMMapContext,
): PendingMapCommandConfirmation | undefined {
  if (command.kind === "nest_card") {
    const child = resolveCommandCardRefDetailed(command.childText, units, map);
    const parent = resolveCommandCardRefDetailed(command.parentText, units, map);
    const near = child.kind === "near" ? child : parent.kind === "near" ? parent : undefined;
    if (!near || near.matches.length !== 1) return undefined;
    const childRef =
      child.kind === "near" ? { id: near.matches[0].id } : child.kind === "resolved" ? child.ref : undefined;
    const parentId =
      parent.kind === "near" ? near.matches[0].id : parent.kind === "resolved" && "id" in parent.ref ? parent.ref.id : undefined;
    if (!childRef || !parentId) return undefined;
    return {
      command: { kind: "nest_card", child: childRef, parentId },
      prompt: `I found an existing card called "${near.matches[0].text}" for "${near.requested}". Did you mean that one?`,
      debug: `near_match_pending: "${near.requested}" -> "${near.matches[0].text}" for nesting ${describeCardRef(childRef, map)} under ${map.thoughtUnits.find((unit) => unit.id === parentId)?.text ?? parentId}`,
    };
  }

  if (command.kind === "connect_cards") {
    const source = resolveCommandCardRefDetailed(command.sourceText, units, map);
    const target = resolveCommandCardRefDetailed(command.targetText, units, map);
    const nearRefs = [source, target].filter(
      (ref): ref is Extract<ResolvedCommandCardRef, { kind: "near" }> => ref.kind === "near",
    );
    if (nearRefs.length === 0 || nearRefs.some((ref) => ref.matches.length !== 1)) return undefined;
    const sourceRef =
      source.kind === "near" ? { id: source.matches[0].id } : source.kind === "resolved" ? source.ref : undefined;
    const targetRef =
      target.kind === "near" ? { id: target.matches[0].id } : target.kind === "resolved" ? target.ref : undefined;
    if (!sourceRef || !targetRef) return undefined;
    if ("id" in sourceRef && "id" in targetRef && sourceRef.id === targetRef.id) return undefined;
    const readableMatches = nearRefs.map((ref) => `"${ref.requested}" -> "${ref.matches[0].text}"`).join(" and ");
    return {
      command: {
        kind: "connect_cards",
        source: sourceRef,
        target: targetRef,
        ...groundedLabel(command, units),
      },
      prompt: `I found existing card matches for this connection: ${readableMatches}. Did you mean those?`,
      debug: `near_match_pending: ${readableMatches} for connection`,
    };
  }

  return undefined;
}

function commandClarificationForNearMatch(
  command: MapCommand,
  units: SourceUtterance[],
  map: LLMMapContext,
): { prompt: string; debug: string } | undefined {
  const refs =
    command.kind === "nest_card"
      ? [resolveCommandCardRefDetailed(command.childText, units, map), resolveCommandCardRefDetailed(command.parentText, units, map)]
      : command.kind === "connect_cards"
      ? [resolveCommandCardRefDetailed(command.sourceText, units, map), resolveCommandCardRefDetailed(command.targetText, units, map)]
      : [];
  const ambiguous = refs.find((ref) => ref.kind === "near" && ref.matches.length > 1) as
    | Extract<ResolvedCommandCardRef, { kind: "near" }>
    | undefined;
  if (!ambiguous) return undefined;
  const names = ambiguous.matches.map((match) => `"${match.text}"`).join(", ");
  return {
    prompt: `I found more than one card that could match "${ambiguous.requested}": ${names}. Which one did you mean?`,
    debug: `near_match_ambiguous: "${ambiguous.requested}" matched ${names}`,
  };
}

function acceptedMapCommands(
  commands: MapCommand[] | undefined,
  units: SourceUtterance[],
  map: LLMMapContext,
): { accepted: AcceptedMapCommand[]; pending?: PendingMapCommandConfirmation; notes: CommandDebugNote[] } {
  const accepted: AcceptedMapCommand[] = [];
  let pending: PendingMapCommandConfirmation | undefined;
  let clarificationPrompt: string | undefined;
  const notes: CommandDebugNote[] = [];
  const seen = new Set<string>();

  for (const command of commands ?? []) {
    if (command.kind !== "create_card") continue;
    const phrase = (command.sourceSpan?.userPhrase ?? command.text ?? "").trim();
    if (!phrase) {
      notes.push({ reason: "missing_card_text", detail: "Blocked create_card with no exact phrase." });
      continue;
    }
    if (isReferentialCardText(phrase)) {
      notes.push({ reason: "referential_card_text", detail: `Blocked referential card text "${phrase}".` });
      continue;
    }

    const sourceUnits = units.filter((unit) => unit.text.includes(phrase));
    if (sourceUnits.length === 0) {
      notes.push({ reason: "not_current_turn_span", detail: `Blocked non-current-turn card text "${phrase}".` });
      continue;
    }
    const citedIds = new Set(command.sourceSpan?.utteranceIds ?? []);
    const currentSourceUnits = citedIds.size > 0
      ? sourceUnits.filter((unit) => citedIds.has(unit.id))
      : sourceUnits;
    if (currentSourceUnits.length === 0) {
      notes.push({ reason: "stale_source_id", detail: `Blocked "${phrase}" because cited ids were not this turn.` });
      continue;
    }
    const eligibleUnits = currentSourceUnits.filter(
      (unit) => !isBlockedCreateCardInterpretation(unit.text, phrase),
    );
    if (eligibleUnits.length === 0) {
      notes.push({ reason: "blocked_interpretation", detail: `Blocked declarative/tentative card command for "${phrase}".` });
      continue;
    }
    if (seen.has(phrase)) continue;

    seen.add(phrase);
    accepted.push({
      kind: "create_card",
      text: phrase,
      sourceUtteranceIds: eligibleUnits.map((unit) => unit.id),
    });
  }

  for (const command of commands ?? []) {
    if (command.kind !== "nest_card") continue;
    const childText = command.childText?.trim();
    const parentId = resolveExistingCardId(command.parentText, map);
    if (!childText || !parentId) {
      const nearPending = acceptedCommandFromNearMatch(command, units, map);
      if (!pending && nearPending) pending = nearPending;
      const clarification = commandClarificationForNearMatch(command, units, map);
      if (!pending && clarification && !clarificationPrompt) clarificationPrompt = clarification.prompt;
      notes.push({
        reason: nearPending ? "near_match_pending" : clarification ? "ambiguous_reference" : "unresolved_reference",
        detail: nearPending?.debug ?? clarification?.debug ?? `Blocked nesting command; could not resolve "${command.parentText ?? ""}".`,
      });
      continue;
    }
    const relevantUnits = units.filter((unit) => unit.text.includes(childText));
    const childResolved = resolveCommandCardRefDetailed(childText, units, map);
    if (childResolved.kind === "near") {
      const nearPending = acceptedCommandFromNearMatch(command, units, map);
      if (!pending && nearPending) pending = nearPending;
      const clarification = commandClarificationForNearMatch(command, units, map);
      if (!pending && clarification && !clarificationPrompt) clarificationPrompt = clarification.prompt;
      notes.push({
        reason: nearPending ? "near_match_pending" : clarification ? "ambiguous_reference" : "unresolved_reference",
        detail: nearPending?.debug ?? clarification?.debug ?? `Blocked near-match nesting child "${childText}".`,
      });
      continue;
    }
    if (childResolved.kind !== "resolved") {
      notes.push({ reason: "unresolved_reference", detail: `Blocked nesting child "${childText}".` });
      continue;
    }
    const child = childResolved.ref;
    if (!("id" in child)) {
      if (relevantUnits.length === 0) {
        notes.push({ reason: "not_current_turn_span", detail: `Blocked nesting child "${childText}" because it was not current-turn wording.` });
        continue;
      }
      if (relevantUnits.every((unit) => isBlockedCreateCardInterpretation(unit.text, childText))) {
        notes.push({ reason: "blocked_interpretation", detail: `Blocked declarative/tentative nesting child "${childText}".` });
        continue;
      }
    }
    const key = `nest:${cardRefKey(child)}->${parentId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({ kind: "nest_card", child, parentId });
  }

  for (const command of commands ?? []) {
    if (command.kind !== "connect_cards") continue;
    const sourceText = command.sourceText?.trim();
    const targetText = command.targetText?.trim();
    if (!sourceText || !targetText) continue;
    const sourceResolved = resolveCommandCardRefDetailed(sourceText, units, map);
    const targetResolved = resolveCommandCardRefDetailed(targetText, units, map);
    // The current-turn grounding gate exists only to stop NEW card text from
    // being minted ungrounded. When both endpoints are existing cards (resolved
    // by #ref or exact text), there is no new structure to ground, so skip it —
    // otherwise an existing-card connection is mis-blocked (e.g. the user's own
    // label wording like "supports" trips the declarative detector).
    const bothExisting =
      sourceResolved.kind === "resolved" && "id" in sourceResolved.ref &&
      targetResolved.kind === "resolved" && "id" in targetResolved.ref;
    if (bothExisting) {
      if (!units.some((unit) => isConnectCommandText(unit.text))) {
        notes.push({ reason: "blocked_interpretation", detail: `Blocked declarative/tentative connection "${sourceText}" -> "${targetText}".` });
        continue;
      }
    } else {
      const relevantUnits = units.filter(
        (unit) => unit.text.includes(sourceText) || unit.text.includes(targetText),
      );
      if (relevantUnits.length === 0) {
        notes.push({ reason: "not_current_turn_span", detail: "Blocked connection; neither endpoint was current-turn wording." });
        continue;
      }
      if (relevantUnits.every((unit) => isBlockedCreateCardInterpretation(unit.text, sourceText) || isBlockedCreateCardInterpretation(unit.text, targetText))) {
        notes.push({ reason: "blocked_interpretation", detail: `Blocked declarative/tentative connection "${sourceText}" -> "${targetText}".` });
        continue;
      }
    }
    if (sourceResolved.kind === "near" || targetResolved.kind === "near") {
      const nearPending = acceptedCommandFromNearMatch(command, units, map);
      if (!pending && nearPending) pending = nearPending;
      const clarification = commandClarificationForNearMatch(command, units, map);
      if (!pending && clarification && !clarificationPrompt) clarificationPrompt = clarification.prompt;
      notes.push({
        reason: nearPending ? "near_match_pending" : clarification ? "ambiguous_reference" : "unresolved_reference",
        detail: nearPending?.debug ?? clarification?.debug ?? `Blocked near-match connection "${sourceText}" -> "${targetText}".`,
      });
      continue;
    }
    if (sourceResolved.kind !== "resolved" || targetResolved.kind !== "resolved") {
      notes.push({ reason: "unresolved_reference", detail: `Blocked connection "${sourceText}" -> "${targetText}".` });
      continue;
    }
    const source = sourceResolved.ref;
    const target = targetResolved.ref;
    if ("id" in source && "id" in target && source.id === target.id) continue;
    const label = groundedLabel(command, units);
    const key = `connect:${cardRefKey(source)}->${cardRefKey(target)}:${label.labelText ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({
      kind: "connect_cards",
      source,
      target,
      ...label,
    });
  }

  return { accepted, pending, notes: clarificationPrompt ? [{ reason: "command_clarification", detail: clarificationPrompt }, ...notes] : notes };
}

function isAffirmative(text: string): boolean {
  return /^(yes|yeah|yep|correct|right|that one|those|exactly|please do|do that|yup)\b/i.test(text.trim());
}

function isNegative(text: string): boolean {
  return /^(no|nope|not that|wrong|cancel|never mind|nevermind)\b/i.test(text.trim());
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
  /** Direct user map commands accepted by controller checks. */
  mapCommands?: AcceptedMapCommand[];
  /** Command acceptance/blocking notes for tester/debug inspection. */
  commandDebug?: CommandDebugNote[];
  /** Set when a direct command is waiting for a simple user confirmation. */
  commandConfirmation?: PendingMapCommandConfirmation;
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
    pendingMapCommand: undefined,
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

  if (state.pendingMapCommand && isAffirmative(userText)) {
    const pending = state.pendingMapCommand;
    state.pendingMapCommand = undefined;
    state.mode = "question";
    state.turnsSinceLastMirror++;
    const text = "Done - what should we place next?";
    state.lastAiText = text;
    return {
      mode: "question",
      text,
      llmTurn: { mode: "question", text },
      mapCommands: [pending.command],
      commandDebug: [{ reason: "near_match_confirmed", detail: pending.debug }],
      questionStance: "organize",
    };
  }

  if (state.pendingMapCommand && isNegative(userText)) {
    const pending = state.pendingMapCommand;
    state.pendingMapCommand = undefined;
    state.mode = "question";
    state.turnsSinceLastMirror++;
    const text = "Okay - which exact card did you mean?";
    state.lastAiText = text;
    return {
      mode: "question",
      text,
      llmTurn: { mode: "question", text },
      commandDebug: [{ reason: "near_match_rejected", detail: pending.debug }],
      questionStance: "organize",
    };
  }

  if (state.pendingMapCommand) {
    state.pendingMapCommand = undefined;
  }

  // 2. Deterministic structural-signal detection PER UNIT (spontaneity scored
  //    against the AI's previous turn so the LLM can't game it). Per-unit means
  //    a relationship signal is tied to the specific sentence that carries it.
  const detectedSignals = units.flatMap((u) =>
    detectSignals(u.id, u.text, state.lastAiText),
  );
  const initialTurnShape = detectTurnShape(userText, units, { config: config.turnShape });

  // 3. Pre-turn ready candidates — passed in LLM context so it knows what it
  //    may mirror. (Computed before candidate updates so it reflects prior state.)
  const preTurnReadyIds = readyCandidates(
    state.candidates.getAll(),
    state.bank.getAll(),
    config,
  ).map((s) => s.candidateId);

  // 4. Build context snapshot and call the LLM.
  const userIsStuck = isStuck(userText);
  const draftDeclarations = detectDraftDeclarations(state.draft, config.draftDeclarations);
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
    turnShape: initialTurnShape,
    draft: state.draft || undefined,
    draftDeclarations,
    map,
  };
  const turn = await llm(ctx);
  const commandResult = acceptedMapCommands(turn.mapCommands, units, map);
  const acceptedCommands = commandResult.accepted;
  const turnShape = acceptedCommands.length > 0
    ? detectTurnShape(userText, units, { hasAcceptedMapCommand: true, config: config.turnShape })
    : initialTurnShape;
  const turnDebugNotes: CommandDebugNote[] = [...commandResult.notes];

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
  let candidateUpserts = turn.candidateUpserts ?? [];
  if (turnShape.kind === "large_exploratory") {
    const ideaUpserts = candidateUpserts.filter((u) => u.target === "idea");
    if (ideaUpserts.length > 1) {
      candidateUpserts = candidateUpserts.filter((u) => u.target !== "idea");
      const dropped = ideaUpserts.length;
      if (dropped > 0) {
        turnDebugNotes.push({
          reason: "large_turn_candidate_filter",
          detail: `dropped ${dropped} broad idea candidate(s) from exploratory turn`,
        });
      }
    }
  }

  for (const u of candidateUpserts) {
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
    if (acceptedCommands.length > 0) {
      out = { ...out, mapCommands: acceptedCommands };
    }
    if (commandResult.notes.length > 0) {
      out = { ...out, commandDebug: turnDebugNotes };
    } else if (turnDebugNotes.length > 0) {
      out = { ...out, commandDebug: turnDebugNotes };
    }
    if (commandResult.pending) {
      state.pendingMapCommand = commandResult.pending;
      state.mode = "question";
      out = {
        ...out,
        mode: "question",
        text: commandResult.pending.prompt,
        validatedMirror: undefined,
        commandConfirmation: commandResult.pending,
        questionAnchor: undefined,
        questionStance: "organize",
      };
    } else {
      const commandClarification = commandResult.notes.find((note) => note.reason === "command_clarification");
      if (commandClarification) {
        state.mode = "question";
        out = {
          ...out,
          mode: "question",
          text: commandClarification.detail,
          validatedMirror: undefined,
          questionAnchor: undefined,
          questionStance: "organize",
        };
      }
    }

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

    if (
      (out.mode === "question" || out.mode === "clarify") &&
      draftDeclarations.length > 0 &&
      isRedundantDraftDeclarationQuestion(out.text, config)
    ) {
      const targeted = targetedDraftDeclarationQuestion(draftDeclarations);
      if (targeted) {
        out = {
          ...out,
          ...targeted,
        };
      }
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
  if (acceptedCommands.length > 0 && turn.mode === "mirror") {
    state.turnsSinceLastMirror++;
    state.mode = "question";
    return finish({
      mode: "question",
      text: "What should we clarify about where it fits?",
      llmTurn: turn,
      pacingSuppressed: true,
      suppressionReason: "command_precedence",
      suppressionDetail: "Accepted direct map command; same-turn mirror suppressed.",
      questionStance: "organize",
    });
  }

  if (turn.mode === "mirror") {
    if (turnShape.kind === "large_exploratory") {
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({
        mode: "question",
        text: "Which one piece of that should we stay with first?",
        llmTurn: turn,
        pacingSuppressed: true,
        suppressionReason: "large_exploratory_turn",
        suppressionDetail: turnShape.reasons.join(", "),
        questionStance: "narrow",
      });
    }

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
    let gatedClaims = turn.mirror.claims.filter((c) => {
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

    // Drop any claim already placed on the map. Re-mirroring a card is noise and
    // confirming it would mint a duplicate. If everything is already placed, the
    // model is re-offering settled structure — downgrade to a question.
    const onMapClaims = gatedClaims.filter((c) => claimAlreadyOnMap(c.text, map));
    const freshClaims = gatedClaims.filter((c) => !claimAlreadyOnMap(c.text, map));
    if (freshClaims.length === 0) {
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({
        mode: "question",
        text: MIRROR_SUPPRESSED_QUESTION,
        llmTurn: turn,
        pacingSuppressed: true,
        suppressionReason: "already_on_map",
        suppressionDetail: `All ${onMapClaims.length} claim(s) already on the map: ${onMapClaims.map((c) => `"${c.text}"`).join(", ")}`,
        questionStance: "organize",
      });
    }
    gatedClaims = freshClaims;

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
    const tentativeBlocked = failingClaims.some((claim) =>
      claim.checks.some((check) => check.check === "tentative_uncertainty" && !check.ok),
    );

    state.mode = "clarify";
    state.clarifyTarget = weakestSpan;
    state.turnsSinceLastMirror++;

    const clarifyText =
      tentativeBlocked
        ? "What would make that feel firm enough to carry forward?"
        : weakestSpan != null
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
