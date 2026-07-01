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
  MirrorClaim,
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
  | "capture_loop"
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
  kind: "reference_confirmation";
  prompt: string;
  command: AcceptedMapCommand;
  debug: string;
}

export interface PendingConnectionLabelCommand {
  kind: "connection_label";
  prompt: string;
  command: Extract<AcceptedMapCommand, { kind: "connect_cards" }>;
  debug: string;
}

export interface PendingRelationshipConfirmationCommand {
  kind: "relationship_confirmation";
  prompt: string;
  command: Extract<AcceptedMapCommand, { kind: "connect_cards" }>;
  labelText: string;
  debug: string;
}

export type PendingMapCommand =
  | PendingMapCommandConfirmation
  | PendingConnectionLabelCommand
  | PendingRelationshipConfirmationCommand;

export interface CommandDebugNote {
  reason: string;
  detail: string;
}

type StructuralVerbIntent = "connect" | "nest" | "ambiguous_join";

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
  pendingMapCommand?: PendingMapCommand;
  organizeFocus?: {
    refs: [string, string];
    key: string;
    declineCount: number;
  };
  pendingChildPlacement?: {
    parentId: string;
    parentText: string;
    remaining: number;
  };
  activeElicitation?: {
    kind: "carry_forward" | "clarify_after_failed_mirror" | "sparse_map_next_card";
    targetPhrase?: string;
  };
  activeSelectionContext?: {
    sourceTurnId: string;
    sourceUtteranceIds: string[];
    selectedUtteranceIds: string[];
    selectedText?: string;
  };
  pendingCardWording?: {
    text: string;
    normalizedText: string;
    utteranceIds: string[];
    source: "carry_forward" | "sparse_map_next_card";
    attemptCount: number;
  };
  captureLoop?: {
    lastAnswerNorm?: string;
    repeatCount: number;
  };
}

export interface ProcessTurnOptions {
  ingestUser?: boolean;
  requireConnectionLabel?: boolean;
  continuationFocus?: string[];
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
const STABLE_CARD_MIN_CONTENT_TOKENS = 2;

function isStuck(text: string): boolean {
  const lower = text.toLowerCase();
  return STUCK_PHRASES.some((p) => lower.includes(p));
}

function wantsToMoveOn(text: string, config: MindmapConfig): boolean {
  return new RegExp(config.coaching.moveOnPattern, "i").test(text);
}

function extractCardPairRefs(text: string): [string, string] | undefined {
  const refs = Array.from(text.matchAll(/#\d+/g)).map((match) => match[0]);
  const unique = Array.from(new Set(refs));
  if (unique.length < 2) return undefined;
  const pair = unique.slice(0, 2).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
  return [pair[0], pair[1]];
}

function cardPairKey(refs: [string, string]): string {
  return `${refs[0]}|${refs[1]}`;
}

function resolveOrganizePair(
  refs: [string, string],
  map: LLMMapContext,
): [AcceptedMapCommandCardRef, AcceptedMapCommandCardRef] | undefined {
  const sourceId = resolveCardRefNumber(refs[0], map);
  const targetId = resolveCardRefNumber(refs[1], map);
  if (!sourceId || !targetId || sourceId === targetId) return undefined;
  return [{ id: sourceId }, { id: targetId }];
}

function nextStepQuestion(draft: string, userText = ""): string {
  if (/\bdraft\b/i.test(userText) && draft.trim()) {
    return "In the draft, which part feels easiest to think through next?";
  }
  return "What would you like to do next?";
}

function childPlacementQuestion(
  parentText: string,
  remaining: number,
): string {
  if (remaining <= 1) {
    return `What exact words do you want on the other smaller card under ${parentText}?`;
  }
  return `What exact words should go on the ${remaining} smaller cards under ${parentText}?`;
}

function sparseMapBlocksOrganize(map: LLMMapContext): boolean {
  return map.thoughtUnits.length > 0 && map.thoughtUnits.length < 3 && map.connections.length === 0;
}

function nextCardQuestion(): string {
  return "What exact wording do you want to carry forward as the next card?";
}

function pendingCardWordingFollowup(text: string): string {
  return `I can use '${text}' as the card wording. What part of that should we unpack first?`;
}

function normalizeComparableText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[“”"'.,!?;:()[\]{}]/g, " ")
    .replace(/\s+/g, " ");
}

function isStableCardLikeAnswer(text: string): boolean {
  if (answersSiblingFraming(text)) return false;
  if (hasInstructionalCardScaffolding(text)) return false;
  if (/\b(?:carry forward|exact wording|on the map|map to carry)\b/i.test(text)) return false;
  const tokens = contentTokens(text);
  return tokens.length >= STABLE_CARD_MIN_CONTENT_TOKENS && tokens.length <= 18;
}

function isChildCardWording(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isStuck(trimmed)) return false;
  if (answersSiblingFraming(trimmed)) return false;
  return contentTokens(trimmed).length > 0;
}

function cancelsChildPlacement(text: string): boolean {
  return /^(no|nope|cancel|never mind|nevermind)$/i.test(text.trim());
}

function isCompactRelationshipAnswer(text: string): boolean {
  if (answersSiblingFraming(text)) return false;
  const trimmed = text.trim();
  if (!trimmed || /#\d+/.test(trimmed)) return false;
  if (/^(no|none|nope|not sure|i don't know|i dont know)\b/i.test(trimmed)) return false;
  if (/\b(?:carry forward|exact wording|on the map|map to carry)\b/i.test(trimmed)) return false;
  const tokens = contentTokens(trimmed);
  return tokens.length > 0 && tokens.length <= 6;
}

function answersSiblingFraming(text: string): boolean {
  const lower = text.toLowerCase();
  const deniesDirectRelation =
    /\b(?:no|not any)\s+(?:relationship|connection)\b/.test(lower) ||
    /\b(?:there (?:is|are)|they(?:'re| are))\s+no\s+(?:relationship|connection)\b/.test(lower);
  const framesSharedParent =
    /\bboth\b/.test(lower) &&
    /\b(?:under|small idea|subpoint|child|same parent|big idea)\b/.test(lower);
  return deniesDirectRelation && framesSharedParent;
}

function carryForwardQuestionForMap(map: LLMMapContext): string {
  return sparseMapBlocksOrganize(map)
    ? nextCardQuestion()
    : "What part of that feels most important to carry forward on the map?";
}

function childPlacementRequest(
  questionText: string,
  map: LLMMapContext,
): { parentId: string; parentText: string; remaining: number } | undefined {
  const lower = questionText.toLowerCase();
  if (!/\b(?:smaller|child|sub)\s+cards?\b/.test(lower)) return undefined;
  if (!/\b(?:exact words|exact wording|words should go|words do you want)\b/.test(lower)) return undefined;

  const explicitParent = map.thoughtUnits
    .filter((unit) => unit.role !== "connection_label")
    .sort((a, b) => b.text.length - a.text.length)
    .find((unit) => normalize(questionText).includes(normalize(unit.text)));
  const roots = map.thoughtUnits.filter((unit) => !unit.parentId && unit.role !== "connection_label");
  const parent = explicitParent ?? roots[roots.length - 1];
  if (!parent) return undefined;

  const remaining = /\b(?:2|two)\b/.test(lower) && !/\bother\b/.test(lower) ? 2 : 1;
  return { parentId: parent.id, parentText: parent.text, remaining };
}

function isCarryForwardQuestion(text: string, map: LLMMapContext): boolean {
  return text === nextCardQuestion() ||
    text.endsWith(` ${nextCardQuestion()}`) ||
    text === "What exact wording do you want the map to carry forward from that?" ||
    text.endsWith(" What exact wording do you want the map to carry forward from that?") ||
    text === carryForwardQuestionForMap(map) ||
    text.endsWith(` ${carryForwardQuestionForMap(map)}`);
}

function setActiveElicitation(
  state: LoopState,
  kind: "carry_forward" | "clarify_after_failed_mirror" | "sparse_map_next_card",
  targetPhrase?: string,
): void {
  state.activeElicitation = { kind, targetPhrase };
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

function hasCommandUncertainty(text: string, config: MindmapConfig): boolean {
  return new RegExp(config.mirror.tentativeEvidencePattern, "i").test(text);
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

function overlapsSelectedStrand(sourceText: string, selectionText: string): boolean {
  const selectionNorm = normalizeComparableText(selectionText);
  const sourceNorm = normalizeComparableText(sourceText);
  if (!selectionNorm || !sourceNorm) return false;
  if (sourceNorm.includes(selectionNorm) || selectionNorm.includes(sourceNorm)) return true;
  const selectedTokens = new Set(contentTokens(selectionText).map((token) => token.toLowerCase()));
  if (selectedTokens.size === 0) return false;
  const overlapCount = contentTokens(sourceText)
    .map((token) => token.toLowerCase())
    .filter((token) => selectedTokens.has(token)).length;
  return overlapCount > 0;
}

function updateSelectionContext(
  state: LoopState,
  userText: string,
): void {
  const ctx = state.activeSelectionContext;
  if (!ctx) return;
  const bank = state.bank.getAll();
  const sourceTurnUtterances = bank.filter((utterance) => utterance.turnId === ctx.sourceTurnId);
  if (sourceTurnUtterances.length === 0) {
    state.activeSelectionContext = undefined;
    return;
  }

  const matched = sourceTurnUtterances
    .filter((utterance) => overlapsSelectedStrand(utterance.text, userText))
    .map((utterance) => utterance.id);
  if (matched.length === 0) return;

  const nextSelectedIds = Array.from(new Set([...ctx.selectedUtteranceIds, ...matched]));
  state.activeSelectionContext = {
    ...ctx,
    selectedUtteranceIds: nextSelectedIds,
    selectedText: ctx.selectedText ?? userText.trim(),
  };
}

function selectionContextSourceIds(state: LoopState): string[] {
  const ctx = state.activeSelectionContext;
  if (!ctx) return [];
  return ctx.selectedUtteranceIds.length > 0 ? ctx.selectedUtteranceIds : ctx.sourceUtteranceIds;
}

function selectedStrandSnapshot(state: LoopState): { selectedText?: string; sourceUtteranceIds: string[] } | undefined {
  const ids = selectionContextSourceIds(state);
  if (ids.length === 0) return undefined;
  return {
    selectedText: state.activeSelectionContext?.selectedText,
    sourceUtteranceIds: ids,
  };
}

function validationPreamble(claims: ClaimValidation[]): string | undefined {
  const failedChecks = claims.flatMap((claim) =>
    claim.checks.filter((check) => !check.ok).map((check) => ({ claim, check })),
  );
  if (failedChecks.some(({ check }) => check.check === "tentative_uncertainty")) {
    return undefined;
  }
  if (failedChecks.some(({ check }) => check.check === "span_grounding") &&
    failedChecks.every(({ check }) => check.check !== "lexical_grounding")) {
    return "I can see the pieces you're naming, but I don't yet have your wording for the relationship itself.";
  }
  if (failedChecks.some(({ check }) => check.check === "lexical_grounding")) {
    return "I think you're pointing at something to carry forward, but I can't ground the wording cleanly enough yet.";
  }
  if (failedChecks.some(({ check }) => check.check === "span_grounding")) {
    return "I think you're pointing at something to carry forward, but I can't place it cleanly yet.";
  }
  return undefined;
}

function readinessPreamble(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  if (/relationship/i.test(reason)) {
    return "I can see the pieces you're naming, but I don't yet have your wording for the relationship itself.";
  }
  if (/non-user words/i.test(reason)) {
    return "I think you're pointing at something to carry forward, but I can't ground the wording cleanly enough yet.";
  }
  if (/grounding/i.test(reason)) {
    return "I think you're pointing at something worth carrying forward, but I don't have enough grounded wording yet.";
  }
  return undefined;
}

function hasInstructionalCardScaffolding(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /\bthis should be\b/.test(lower) ||
    /\bshould go under\b/.test(lower) ||
    /\bone of the main\b/.test(lower) ||
    /\bmain idea\b/.test(lower) ||
    /\bunder\s+[a-z#]/.test(lower) ||
    /\bsubpoint\b/.test(lower) ||
    /\bsmall idea\b/.test(lower)
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

function detectStructuralVerbIntent(text: string): StructuralVerbIntent | undefined {
  const lower = text.toLowerCase();
  if (/\b(?:nest|under|inside|subpoint|child)\b/.test(lower)) return "nest";
  if (/\b(?:connect|link)\b/.test(lower)) return "connect";
  if (/\b(?:join|combine|merge)\b/.test(lower)) return "ambiguous_join";
  return undefined;
}

function extractExplicitRefPair(text: string): [string, string] | undefined {
  const refs = Array.from(text.matchAll(/#\d+/g)).map((match) => match[0]);
  const unique = Array.from(new Set(refs));
  return unique.length >= 2 ? [unique[0], unique[1]] : undefined;
}

function explicitRefCommandClarification(
  userText: string,
): { prompt: string; debug: string } | undefined {
  const refs = extractExplicitRefPair(userText);
  if (!refs) return undefined;
  const intent = detectStructuralVerbIntent(userText);
  if (!intent) return undefined;

  if (intent === "ambiguous_join") {
    return {
      prompt: `I'm not sure what you mean by join here - do you want to connect ${refs[0]} and ${refs[1]}, or nest one under the other?`,
      debug: `explicit_ref_command_clarification: ambiguous join/combine for ${refs[0]} and ${refs[1]}`,
    };
  }

  if (intent === "nest" && /\bnest\s+to\b/i.test(userText)) {
    return {
      prompt: `Do you want to nest one of those cards under the other? If so, which one should go under which: ${refs[0]} or ${refs[1]}?`,
      debug: `explicit_ref_command_clarification: awkward nest phrasing for ${refs[0]} and ${refs[1]}`,
    };
  }

  return undefined;
}

function explicitRefNestCommand(
  userText: string,
  map: LLMMapContext,
): Extract<AcceptedMapCommand, { kind: "nest_card" }> | undefined {
  const match = userText.match(/\b(?:put|nest|move)\s+(#\d+)\s+(?:in|into|inside|under)\s+(#\d+)\b/i);
  if (!match) return undefined;
  const childId = resolveCardRefNumber(match[1], map);
  const parentId = resolveCardRefNumber(match[2], map);
  if (!childId || !parentId || childId === parentId) return undefined;
  return {
    kind: "nest_card",
    child: { id: childId },
    parentId,
  };
}

function currentTurnSourceIdsForPhrase(
  phrase: string | undefined,
  units: SourceUtterance[],
): string[] {
  const trimmed = phrase?.trim();
  if (!trimmed || isReferentialCardText(trimmed)) return [];
  return units.filter((unit) => unit.text.includes(trimmed)).map((unit) => unit.id);
}

function extractNaturalConnectionLabel(units: SourceUtterance[]): string | undefined {
  for (const unit of units) {
    const quoted =
      unit.text.match(/\bwith the label\b\s*["“'‘]([^"”'’]+?)["”'’]/i) ??
      unit.text.match(/\blabeled\b\s*["“'‘]([^"”'’]+?)["”'’]/i);
    const fallback =
      unit.text.match(/\bwith the label\b\s+(.+?)(?:[.!?]|$)/i) ??
      unit.text.match(/\blabeled\b\s+(.+?)(?:[.!?]|$)/i);
    const raw = quoted?.[1] ?? fallback?.[1];
    if (!raw) continue;
    const trimmed = raw.trim().replace(/[.!?]+$/, "").trim();
    if (trimmed) return trimmed;
  }
  return undefined;
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

function nearExistingCardMatch(
  claimText: string,
  map: LLMMapContext,
): { id: string; text: string } | undefined {
  const target = normalize(claimText);
  if (!target) return undefined;
  const targetTokens = contentTokens(target);
  if (targetTokens.length < 2) return undefined;

  for (const unit of map.thoughtUnits) {
    if (unit.role === "connection_label") continue;
    const unitText = normalize(unit.text);
    if (!unitText || unitText === target) continue;
    const unitTokens = contentTokens(unitText);
    if (unitTokens.length < 2) continue;

    const shorter = targetTokens.length <= unitTokens.length ? targetTokens : unitTokens;
    const longer = new Set(targetTokens.length <= unitTokens.length ? unitTokens : targetTokens);
    const overlap = shorter.filter((token) => longer.has(token)).length;
    const containment = target.includes(unitText) || unitText.includes(target);
    const nearSubset = overlap >= Math.max(2, Math.ceil(shorter.length * 0.8));

    if (containment && nearSubset) {
      return { id: unit.id, text: unit.text };
    }
  }

  return undefined;
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
  const labelText =
    command.labelText?.trim() ||
    (command.kind === "connect_cards" ? extractNaturalConnectionLabel(units) : undefined);
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
      kind: "reference_confirmation",
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
      kind: "reference_confirmation",
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
  options: { requireConnectionLabel?: boolean; userText?: string } = {},
): { accepted: AcceptedMapCommand[]; pending?: PendingMapCommand; notes: CommandDebugNote[] } {
  const requireConnectionLabel = options.requireConnectionLabel ?? false;
  const userText = options.userText ?? "";
  const accepted: AcceptedMapCommand[] = [];
  let pending: PendingMapCommand | undefined;
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
    if (requireConnectionLabel && !label.labelText) {
      if (!pending) {
        pending = {
          kind: "connection_label",
          command: {
            kind: "connect_cards",
            source,
            target,
          },
          prompt: `What should the label be between "${describeCardRef(source, map)}" and "${describeCardRef(target, map)}"?`,
          debug: `connection_label_pending: awaiting label for ${describeCardRef(source, map)} -> ${describeCardRef(target, map)}`,
        };
      }
      notes.push({
        reason: "missing_connection_label",
        detail: `Held connection "${describeCardRef(source, map)}" -> "${describeCardRef(target, map)}" until the user supplies a label.`,
      });
      continue;
    }
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

  if (!pending && accepted.length === 0 && !clarificationPrompt) {
    const explicitRefClarification = explicitRefCommandClarification(userText);
    if (explicitRefClarification) {
      clarificationPrompt = explicitRefClarification.prompt;
      notes.push({
        reason: "command_clarification",
        detail: explicitRefClarification.debug,
      });
    }
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

function mirrorEligibleBank(bank: SourceUtterance[]): SourceUtterance[] {
  return bank.filter((utterance) => !utterance.commandOnly);
}

function commandConsumedUtteranceIds(commands: AcceptedMapCommand[]): Set<string> {
  const ids = new Set<string>();
  for (const command of commands) {
    if (command.kind === "create_card") {
      for (const id of command.sourceUtteranceIds) ids.add(id);
      continue;
    }
    if (command.kind === "nest_card") {
      if (!("id" in command.child)) {
        for (const id of command.child.sourceUtteranceIds) ids.add(id);
      }
      continue;
    }
    if (!("id" in command.source)) {
      for (const id of command.source.sourceUtteranceIds) ids.add(id);
    }
    if (!("id" in command.target)) {
      for (const id of command.target.sourceUtteranceIds) ids.add(id);
    }
    for (const id of command.labelSourceUtteranceIds ?? []) ids.add(id);
  }
  return ids;
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
  /** Set when a direct command is waiting for a follow-up confirmation or label. */
  commandConfirmation?: PendingMapCommand;
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
    organizeFocus: undefined,
    pendingChildPlacement: undefined,
    activeElicitation: undefined,
    activeSelectionContext: undefined,
    pendingCardWording: undefined,
    captureLoop: undefined,
  };
}

export async function processTurn(
  state: LoopState,
  userText: string,
  llm: MockLLM,
  config: MindmapConfig = defaultConfig,
  origin: UtteranceOrigin = "chat",
  map: LLMMapContext = { thoughtUnits: [], connections: [] },
  options: ProcessTurnOptions = {},
): Promise<TurnOutput> {
  const ingestUser = options.ingestUser ?? true;
  const requireConnectionLabel = options.requireConnectionLabel ?? false;
  const continuationFocus = options.continuationFocus ?? [];
  // 1. Record the user's words, segmented into sentence-level units so a big
  //    voice chunk becomes several grounded units rather than one opaque blob.
  const units = ingestUser ? state.bank.addSegmented(userText, origin) : [];
  const mapIsSparse = sparseMapBlocksOrganize(map);

  if (ingestUser) {
    updateSelectionContext(state, userText);
    if (
      state.activeElicitation &&
      (state.activeElicitation.kind === "carry_forward" || state.activeElicitation.kind === "sparse_map_next_card") &&
      isStableCardLikeAnswer(userText)
    ) {
      const normalized = normalizeComparableText(userText);
      const previous = state.captureLoop?.lastAnswerNorm;
      state.captureLoop = {
        lastAnswerNorm: normalized,
        repeatCount: previous === normalized ? (state.captureLoop?.repeatCount ?? 0) + 1 : 1,
      };
      state.pendingCardWording = {
        text: userText.trim(),
        normalizedText: normalized,
        utteranceIds: units.map((unit) => unit.id),
        source: state.activeElicitation.kind,
        attemptCount: state.pendingCardWording?.normalizedText === normalized
          ? state.pendingCardWording.attemptCount + 1
          : 1,
      };
    } else if (
      !state.activeElicitation ||
      (state.activeElicitation.kind !== "carry_forward" && state.activeElicitation.kind !== "sparse_map_next_card")
    ) {
      state.captureLoop = undefined;
      state.pendingCardWording = undefined;
    }
  }

  if (state.pendingMapCommand?.kind === "reference_confirmation" && isAffirmative(userText)) {
    const pending = state.pendingMapCommand;
    state.pendingMapCommand = undefined;
    state.mode = "question";
    state.activeElicitation = undefined;
    state.pendingCardWording = undefined;
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

  if (state.pendingMapCommand?.kind === "reference_confirmation" && isNegative(userText)) {
    const pending = state.pendingMapCommand;
    state.pendingMapCommand = undefined;
    state.mode = "question";
    state.activeElicitation = undefined;
    state.pendingCardWording = undefined;
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

  if (state.pendingMapCommand?.kind === "connection_label") {
    const pending = state.pendingMapCommand;
    state.pendingMapCommand = undefined;
    state.mode = "question";
    state.activeElicitation = undefined;
    state.pendingCardWording = undefined;
    state.turnsSinceLastMirror++;
    if (isNegative(userText)) {
      const text = "Okay - I won't create that connection.";
      state.lastAiText = text;
      return {
        mode: "question",
        text,
        llmTurn: { mode: "question", text },
        commandDebug: [{ reason: "connection_label_cancelled", detail: pending.debug }],
        questionStance: "organize",
      };
    }

    const labelText = userText.trim();
    state.bank.markCommandOnly(units.map((unit) => unit.id));
    state.lastAiText = "Done.";
    return {
      mode: "question",
      text: "Done.",
      llmTurn: { mode: "question", text: "Done." },
      mapCommands: [
        {
          ...pending.command,
          labelText,
          labelSourceUtteranceIds: units.map((unit) => unit.id),
        },
      ],
      commandDebug: [{ reason: "connection_label_completed", detail: pending.debug }],
      questionStance: "organize",
    };
  }

  if (state.pendingMapCommand?.kind === "relationship_confirmation" && isAffirmative(userText)) {
    const pending = state.pendingMapCommand;
    state.pendingMapCommand = undefined;
    state.mode = "question";
    state.activeElicitation = undefined;
    state.pendingCardWording = undefined;
    state.turnsSinceLastMirror++;
    const text = "Done. What would you like to do next?";
    state.lastAiText = text;
    return {
      mode: "question",
      text,
      llmTurn: { mode: "question", text },
      mapCommands: [pending.command],
      commandConfirmation: pending,
      commandDebug: [{ reason: "relationship_confirmed", detail: pending.debug }],
      questionStance: "organize",
    };
  }

  if (state.pendingMapCommand?.kind === "relationship_confirmation" && isNegative(userText)) {
    const pending = state.pendingMapCommand;
    state.pendingMapCommand = undefined;
    state.mode = "question";
    state.activeElicitation = undefined;
    state.pendingCardWording = undefined;
    state.turnsSinceLastMirror++;
    const text = "Okay - what relationship wording would you use instead?";
    state.lastAiText = text;
    return {
      mode: "question",
      text,
      llmTurn: { mode: "question", text },
      commandDebug: [{ reason: "relationship_rejected", detail: pending.debug }],
      questionStance: "organize",
    };
  }

  if (state.pendingMapCommand) {
    state.pendingMapCommand = undefined;
  }

  const directExplicitRefNest = explicitRefNestCommand(userText, map);
  if (directExplicitRefNest) {
    state.bank.markCommandOnly(units.map((unit) => unit.id));
    state.mode = "question";
    state.activeElicitation = undefined;
    state.pendingCardWording = undefined;
    state.pendingChildPlacement = undefined;
    state.turnsSinceLastMirror++;
    const text = "Done. What would you like to do next?";
    state.lastAiText = text;
    return {
      mode: "question",
      text,
      llmTurn: { mode: "question", text },
      mapCommands: [directExplicitRefNest],
      commandDebug: [{ reason: "explicit_ref_nest", detail: `Executed direct nesting command ${userText.trim()}` }],
      questionStance: "organize",
    };
  }

  const explicitMoveOn = wantsToMoveOn(userText, config);
  if (state.pendingChildPlacement) {
    if (explicitMoveOn || cancelsChildPlacement(userText)) {
      state.pendingChildPlacement = undefined;
    } else if (ingestUser && isChildCardWording(userText)) {
      const pending = state.pendingChildPlacement;
      const remaining = Math.max(0, pending.remaining - 1);
      state.pendingChildPlacement = remaining > 0
        ? { ...pending, remaining }
        : undefined;
      state.activeElicitation = undefined;
      state.pendingCardWording = undefined;
      state.bank.markCommandOnly(units.map((unit) => unit.id));
      state.mode = "question";
      state.turnsSinceLastMirror++;
      const text = remaining > 0
        ? childPlacementQuestion(pending.parentText, remaining)
        : "Done. What would you like to do next?";
      state.lastAiText = text;
      return {
        mode: "question",
        text,
        llmTurn: { mode: "question", text },
        mapCommands: [
          {
            kind: "nest_card",
            child: { text: userText.trim(), sourceUtteranceIds: units.map((unit) => unit.id) },
            parentId: pending.parentId,
          },
        ],
        commandDebug: [
          {
            reason: "pending_child_placement",
            detail: `Nested exact child wording under "${pending.parentText}".`,
          },
        ],
        questionStance: "narrow",
      };
    }
  }

  if (state.organizeFocus) {
    if (mapIsSparse && answersSiblingFraming(userText)) {
      state.organizeFocus = undefined;
      state.mode = "question";
      state.turnsSinceLastMirror++;
      const text = "I'm holding off on organizing this yet because the map is still too sparse. What exact wording do you want to carry forward as the next card?";
      state.lastAiText = text;
      setActiveElicitation(state, "sparse_map_next_card");
      return {
        mode: "question",
        text,
        llmTurn: { mode: "question", text },
        questionStance: "organize",
      };
    }

    if (explicitMoveOn) {
      state.organizeFocus = undefined;
      state.activeElicitation = undefined;
      state.mode = "question";
      state.turnsSinceLastMirror++;
      const text = nextStepQuestion(state.draft, userText);
      state.lastAiText = text;
      return {
        mode: "question",
        text,
        llmTurn: { mode: "question", text },
        questionStance: state.draft.trim() ? "deepen" : "organize",
      };
    }

    if (isStuck(userText)) {
      const nextDeclines = state.organizeFocus.declineCount + 1;
      if (nextDeclines >= config.coaching.organizePairDeclineLimit) {
        state.organizeFocus = undefined;
        state.activeElicitation = undefined;
        state.mode = "question";
        state.turnsSinceLastMirror++;
        const text = nextStepQuestion(state.draft, userText);
        state.lastAiText = text;
        return {
          mode: "question",
          text,
          llmTurn: { mode: "question", text },
          questionStance: state.draft.trim() ? "deepen" : "organize",
        };
      }
      state.organizeFocus = {
        ...state.organizeFocus,
        declineCount: nextDeclines,
      };
    }

    if (state.organizeFocus && isCompactRelationshipAnswer(userText)) {
      const pair = resolveOrganizePair(state.organizeFocus.refs, map);
      if (pair) {
        const labelText = userText.trim();
        const labelSourceUtteranceIds = units.map((unit) => unit.id);
        state.bank.markCommandOnly(labelSourceUtteranceIds);
        state.pendingMapCommand = {
          kind: "relationship_confirmation",
          labelText,
          command: {
            kind: "connect_cards",
            source: pair[0],
            target: pair[1],
            labelText,
            labelSourceUtteranceIds,
          },
          prompt: `It sounds like you want the relationship wording to be '${labelText}' between ${state.organizeFocus.refs[0]} and ${state.organizeFocus.refs[1]}. Is that right?`,
          debug: `relationship_confirmation_pending: ${state.organizeFocus.refs[0]} -> ${state.organizeFocus.refs[1]} label "${labelText}"`,
        };
        state.mode = "question";
        state.activeElicitation = undefined;
        state.pendingCardWording = undefined;
        state.turnsSinceLastMirror++;
        state.lastAiText = state.pendingMapCommand.prompt;
        return {
          mode: "question",
          text: state.pendingMapCommand.prompt,
          llmTurn: { mode: "question", text: state.pendingMapCommand.prompt },
          commandConfirmation: state.pendingMapCommand,
          commandDebug: [{ reason: "relationship_confirmation_pending", detail: state.pendingMapCommand.debug }],
          questionStance: "organize",
        };
      }
    }
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
  const bankForMirrors = mirrorEligibleBank(state.bank.getAll());
  const preTurnReadyIds = readyCandidates(
    state.candidates.getAll(),
    bankForMirrors,
    config,
  ).map((s) => s.candidateId);

  // 4. Build context snapshot and call the LLM.
  const userIsStuck = isStuck(userText);
  const draftDeclarations = detectDraftDeclarations(state.draft, config.draftDeclarations);
  const ctx: LLMContext = {
    bank: bankForMirrors,
    candidates: state.candidates.getAll(),
    turnsSinceLastMirror: state.turnsSinceLastMirror,
    clarifyTarget: state.clarifyTarget,
    detectedSignals,
    readyCandidateIds: preTurnReadyIds,
    userIsStuck,
    lastAiText: state.lastAiText,
    turnText: userText,
    turnShape: initialTurnShape,
    continuationFocus,
    activeElicitation: state.activeElicitation,
    activeSelectionContext: selectedStrandSnapshot(state),
    organizeFocus: state.organizeFocus
      ? {
          refs: state.organizeFocus.refs,
          declineCount: state.organizeFocus.declineCount,
        }
      : undefined,
    sparseMapBlocksOrganize: mapIsSparse,
    draft: state.draft || undefined,
    draftDeclarations,
    map,
  };
  const turn = await llm(ctx);
  const commandResult = acceptedMapCommands(turn.mapCommands, units, map, {
    requireConnectionLabel,
    userText,
  });
  const acceptedCommands = commandResult.accepted;
  const turnShape = acceptedCommands.length > 0
    ? detectTurnShape(userText, units, { hasAcceptedMapCommand: true, config: config.turnShape })
    : initialTurnShape;
  const turnDebugNotes: CommandDebugNote[] = [...commandResult.notes];
  const commandConsumedIds = commandConsumedUtteranceIds(acceptedCommands);
  const ideaEvidenceIds = new Set(
    (turn.candidateUpserts ?? [])
      .filter((candidate) => candidate.target === "idea")
      .flatMap((candidate) => candidate.addEvidenceIds),
  );
  const commandOnlyIds = units
    .filter((unit) =>
      acceptedCommands.length > 0 &&
      (commandConsumedIds.has(unit.id) || !ideaEvidenceIds.has(unit.id)),
    )
    .map((unit) => unit.id);
  if (commandOnlyIds.length > 0) {
    state.bank.markCommandOnly(commandOnlyIds);
  }
  const eligibleBankIds = new Set(mirrorEligibleBank(state.bank.getAll()).map((utterance) => utterance.id));

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
      (id) => state.bank.get(id) !== undefined && eligibleBankIds.has(id),
    );
    if (acceptedCommands.length > 0 && validEvidence.length === 0) continue;
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
  const selectedContextIds = new Set(selectionContextSourceIds(state));
  const substantiveThisTurnUtteranceIds = new Set(
    units
      .filter((u) => contentTokens(u.text).length >= CARRY_FORWARD_MIN_CONTENT_TOKENS)
      .map((u) => u.id),
  );
  const acceleratedEvidenceByCandidate = new Map<string, Set<string>>();
  const focusedCarryForwardIdeaIds = new Set<string>();
  for (const candidateId of turn.carryForwardCandidateIds ?? []) {
    const candidate = state.candidates.get(candidateId);
    if (!candidate || candidate.target !== "idea") continue;
    focusedCarryForwardIdeaIds.add(candidateId);
    const thisTurnEvidence = candidate.evidenceUtteranceIds.filter(
      (id) => thisTurnUtteranceIds.has(id) && substantiveThisTurnUtteranceIds.has(id),
    );
    if (thisTurnEvidence.length === 0) continue;
    acceleratedEvidenceByCandidate.set(candidateId, new Set(thisTurnEvidence));
  }
  if (
    state.activeElicitation &&
    isStableCardLikeAnswer(userText) &&
    turnShape.kind !== "large_exploratory"
  ) {
    const responsiveIdeaUpserts = candidateUpserts.filter((candidate) =>
      candidate.target === "idea" &&
      candidate.addEvidenceIds.some(
        (id) => thisTurnUtteranceIds.has(id) && substantiveThisTurnUtteranceIds.has(id),
      ),
    );
    if (responsiveIdeaUpserts.length === 1) {
      const candidate = state.candidates.get(responsiveIdeaUpserts[0].id);
      if (candidate) {
        focusedCarryForwardIdeaIds.add(candidate.id);
        const responsiveEvidence = candidate.evidenceUtteranceIds.filter(
          (id) =>
            (thisTurnUtteranceIds.has(id) && substantiveThisTurnUtteranceIds.has(id)) ||
            selectedContextIds.has(id),
        );
        if (responsiveEvidence.length > 0) {
          acceleratedEvidenceByCandidate.set(candidate.id, new Set(responsiveEvidence));
        }
      }
    }
  }
  const acceleratedIdeaIds = new Set(acceleratedEvidenceByCandidate.keys());
  const postUpdateBank = mirrorEligibleBank(state.bank.getAll());
  const normalPostUpdateReadyIds = readyCandidates(
    state.candidates.getAll(),
    postUpdateBank,
    config,
  ).map((s) => s.candidateId);
  const postUpdateReadyIds = readyCandidates(
    state.candidates.getAll(),
    postUpdateBank,
    config,
    acceleratedIdeaIds,
  ).map((s) => s.candidateId);
  const postUpdateReadiness = state.candidates
    .getAll()
    .map((candidate) => evaluateReadiness(candidate, postUpdateBank, config, acceleratedIdeaIds));
  const readinessByCandidate = new Map(postUpdateReadiness.map((signal) => [signal.candidateId, signal]));

  // De-escalation used to break a verbatim-repeat loop (see finish()).
  const DE_ESCALATE =
    "Let's zoom out a little — what's one small piece of this you feel sure about?";
  const MIRROR_SUPPRESSED_REPEAT_QUESTION =
    "What exact wording do you want the map to carry forward from that?";
  const normalizeText = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

  function finish(out: TurnOutput): TurnOutput {
    const commandClarification = commandResult.notes.find((note) => note.reason === "command_clarification");
    const commandPromptActive = Boolean(commandResult.pending || commandClarification);
    let sparseMapRewritten = false;
    let repeatedCaptureBlocked = false;
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

    if (
      mapIsSparse &&
      !commandPromptActive &&
      out.mode === "question" &&
      out.suppressionReason !== "command_precedence" &&
      (out.questionStance === "organize" || turn.questionIntent === "organize" || turn.questionStance === "organize")
    ) {
      const pendingWording = state.pendingCardWording;
      out = {
        ...out,
        text: pendingWording ? pendingCardWordingFollowup(pendingWording.text) : nextCardQuestion(),
        questionAnchor: undefined,
        questionStance: pendingWording ? "deepen" : "organize",
      };
      sparseMapRewritten = true;
    }

    const organizePair =
      (out.mode === "question" || out.mode === "clarify") &&
      (out.questionStance === "organize" || turn.questionIntent === "organize" || turn.questionStance === "organize")
        ? extractCardPairRefs(out.text)
        : undefined;

    if (organizePair) {
      const key = cardPairKey(organizePair);
      const isSamePair = state.organizeFocus?.key === key;
      if (isSamePair && (state.organizeFocus?.declineCount ?? 0) >= config.coaching.organizePairDeclineLimit) {
        out = {
          ...out,
          mode: "question",
          text: nextStepQuestion(state.draft),
          questionAnchor: undefined,
          questionStance: state.draft.trim() ? "deepen" : "organize",
        };
        state.organizeFocus = undefined;
      } else {
        state.organizeFocus = {
          refs: organizePair,
          key,
          declineCount: isSamePair ? state.organizeFocus?.declineCount ?? 0 : 0,
        };
      }
    } else if (out.mode === "question" || out.mode === "clarify") {
      state.organizeFocus = undefined;
    }

    if (
      out.mode === "question" &&
      !commandPromptActive &&
      state.pendingCardWording &&
      (state.captureLoop?.repeatCount ?? 0) < 2 &&
      isCarryForwardQuestion(out.text, map)
    ) {
      out = {
        ...out,
        text: pendingCardWordingFollowup(state.pendingCardWording.text),
        questionAnchor: undefined,
        questionStance: "deepen",
      };
    }

    if (
      out.mode === "question" &&
      !commandPromptActive &&
      isCarryForwardQuestion(out.text, map) &&
      (state.captureLoop?.repeatCount ?? 0) >= 2
    ) {
      repeatedCaptureBlocked = true;
      out = {
        ...out,
        mode: "clarify",
        text: "I think you're pointing at something to carry forward, but I still can't place it cleanly from that wording alone. What part of that wording matters most to keep exactly as-is?",
        suppressionReason: "capture_loop",
        suppressionDetail: `Repeated capture answer: ${state.captureLoop?.lastAnswerNorm ?? ""}`,
        questionAnchor: undefined,
        questionStance: "deepen",
      };
      state.clarifyTarget = undefined;
    }

    // Anti-repeat guard: if a question/clarify turn would say verbatim what we
    // just said, the model is stuck in a loop (e.g. re-asking the same pinned
    // clarify span). Swap in a de-escalating question and drop the pin so the
    // next turn is free to re-angle. Mirror turns are exempt — their fixed
    // preamble repeats legitimately. Command hand-backs ("Done. What would you
    // like to do next?") are exempt too: back-to-back commands repeat it
    // legitimately and it is not a stuck loop.
    if (
      (out.mode === "question" || out.mode === "clarify") &&
      out.suppressionReason !== "command_precedence" &&
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

    if (!commandPromptActive && (out.mode === "question" || out.mode === "clarify")) {
      let preamble: string | undefined;
      if (out.suppressionReason === "large_exploratory_turn") {
        preamble = "I'm treating that as a big exploratory dump, so I want to help you choose one piece rather than harvest it.";
      } else if (sparseMapRewritten) {
        preamble = "I'm holding off on organizing this yet because the map is still too sparse.";
      } else if (repeatedCaptureBlocked) {
        preamble = undefined;
      } else if (out.suppressionReason === "validation_failed" && out.blockedClaims) {
        preamble = validationPreamble(out.blockedClaims);
      } else if (out.suppressionReason === "not_ready") {
        preamble = readinessPreamble(out.suppressionDetail);
      }
      if (preamble && !out.text.startsWith(preamble)) {
        out = {
          ...out,
          text: `${preamble} ${out.text}`,
        };
      }
    }

    if (out.mode === "mirror") {
      state.activeElicitation = undefined;
      state.captureLoop = undefined;
      state.pendingCardWording = undefined;
      state.pendingChildPlacement = undefined;
    } else if (out.mode === "clarify" && out.suppressionReason === "validation_failed") {
      setActiveElicitation(state, "clarify_after_failed_mirror", state.clarifyTarget?.userPhrase);
    } else if (out.mode === "question" && (out.text === nextCardQuestion() || out.text.endsWith(` ${nextCardQuestion()}`))) {
      setActiveElicitation(state, "sparse_map_next_card");
    } else if (
      out.mode === "question" &&
      out.text.includes("as the card wording. What part of that should we unpack first?")
    ) {
      setActiveElicitation(state, "carry_forward", state.pendingCardWording?.text);
    } else if (out.mode === "question" && isCarryForwardQuestion(out.text, map)) {
      setActiveElicitation(state, "carry_forward");
    } else if (out.mode === "clarify" && state.clarifyTarget) {
      setActiveElicitation(state, "clarify_after_failed_mirror", state.clarifyTarget.userPhrase);
    } else {
      state.activeElicitation = undefined;
      state.pendingCardWording = undefined;
    }
    if (out.mode === "question") {
      const pendingChildPlacement = childPlacementRequest(out.text, map);
      if (pendingChildPlacement) {
        state.pendingChildPlacement = pendingChildPlacement;
      }
    } else if (out.mode === "mirror" || out.mode === "clarify") {
      state.pendingChildPlacement = undefined;
    }
    if (
      out.mode === "question" &&
      initialTurnShape.kind === "large_exploratory" &&
      units.length > 0
    ) {
      state.activeSelectionContext = {
        sourceTurnId: units[0].turnId ?? "",
        sourceUtteranceIds: units.map((unit) => unit.id),
        selectedUtteranceIds: [],
      };
    } else if (out.mode === "mirror") {
      state.activeSelectionContext = undefined;
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
  if (acceptedCommands.length > 0) {
    // A complete command with no uncertainty is terminal: execute it, confirm,
    // and hand control back to the user (they decide what to do next) — never
    // fall through to a mirror or a reflective probe about the same content.
    if (!hasCommandUncertainty(userText, config)) {
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({
        mode: "question",
        text: "Done. What would you like to do next?",
        llmTurn: turn,
        pacingSuppressed: true,
        suppressionReason: "command_precedence",
        suppressionDetail: "Accepted complete direct map command; handed control back to the user.",
        questionStance: "organize",
      });
    }

    // Command plus uncertainty about a different aspect: if the model tried to
    // mirror, suppress that mirror and ask about the uncertain part instead. If
    // it already chose question/clarify, let that follow-up proceed below.
    if (turn.mode === "mirror") {
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({
        mode: "question",
        text: "What should we clarify about where it fits?",
        llmTurn: turn,
        pacingSuppressed: true,
        suppressionReason: "command_precedence",
        suppressionDetail: "Accepted direct map command; same-turn mirror suppressed for the uncertain part.",
        questionStance: "organize",
      });
    }
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
      return finish({ mode: "question", text: carryForwardQuestionForMap(map), llmTurn: turn, pacingSuppressed: true, suppressionReason: "cooldown", questionStance: "organize" });
    }

    if (!turn.mirror) {
      state.turnsSinceLastMirror++;
      state.mode = "question";
      return finish({ mode: "question", text: carryForwardQuestionForMap(map), llmTurn: turn, pacingSuppressed: true, suppressionReason: "missing_mirror_payload", questionStance: "organize" });
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

    if (state.activeElicitation && focusedCarryForwardIdeaIds.size > 0) {
      const focusedClaims = gatedClaims.filter((claim) => focusedCarryForwardIdeaIds.has(claim.candidateId));
      if (focusedClaims.length > 0) {
        gatedClaims = focusedClaims;
      }
    }

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
      return finish({ mode: "question", text: carryForwardQuestionForMap(map), llmTurn: turn, pacingSuppressed: true, suppressionReason: "not_ready", suppressionDetail, questionStance: "organize" });
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
        text: carryForwardQuestionForMap(map),
        llmTurn: turn,
        pacingSuppressed: true,
        suppressionReason: "already_on_map",
        suppressionDetail: `All ${onMapClaims.length} claim(s) already on the map: ${onMapClaims.map((c) => `"${c.text}"`).join(", ")}`,
        questionStance: "organize",
      });
    }
    gatedClaims = freshClaims;

    if (state.activeElicitation && focusedCarryForwardIdeaIds.size > 0) {
      const focusedFreshClaims = gatedClaims.filter((claim) => focusedCarryForwardIdeaIds.has(claim.candidateId));
      if (focusedFreshClaims.length > 1) {
        state.turnsSinceLastMirror++;
        state.mode = "clarify";
        state.clarifyTarget = undefined;
        return finish({
          mode: "clarify",
          text: "I think you're pointing at one card here, but I'm hearing more than one claim in that answer. What exact wording do you want on the card itself?",
          llmTurn: turn,
          suppressionReason: "not_ready",
          suppressionDetail: `multiple focused claims: ${focusedFreshClaims.map((claim) => claim.text).join(" | ")}`,
          questionStance: "narrow",
        });
      }

      const nearExistingClaim = focusedFreshClaims
        .map((claim) => ({ claim, match: nearExistingCardMatch(claim.text, map) }))
        .find((entry): entry is { claim: MirrorClaim; match: { id: string; text: string } } => entry.match !== undefined);
      if (nearExistingClaim) {
        state.turnsSinceLastMirror++;
        state.mode = "clarify";
        state.clarifyTarget = undefined;
        return finish({
          mode: "clarify",
          text: `That seems close to ${nearExistingClaim.match.id}. Do you want this as a separate card, or should ${nearExistingClaim.match.id} be edited/reworded?`,
          llmTurn: turn,
          suppressionReason: "not_ready",
          suppressionDetail: `near existing card ${nearExistingClaim.match.id}: ${nearExistingClaim.match.text}`,
          questionStance: "narrow",
        });
      }

      const instructionalClaim = focusedFreshClaims.find((claim) => hasInstructionalCardScaffolding(claim.text));
      if (instructionalClaim) {
        state.turnsSinceLastMirror++;
        state.mode = "clarify";
        state.clarifyTarget = undefined;
        return finish({
          mode: "clarify",
          text: "I can hear the card wording inside that, but the rest sounds like instructions about where it fits. What exact wording should the card itself carry?",
          llmTurn: turn,
          suppressionReason: "not_ready",
          suppressionDetail: `instructional card scaffolding: ${instructionalClaim.text}`,
          questionStance: "narrow",
        });
      }
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
      return finish({ mode: "question", text: carryForwardQuestionForMap(map), llmTurn: turn, pacingSuppressed: true, suppressionReason: "batch_preference", suppressionDetail: `${postUpdateReadyIds.length}/${config.pacing.minReadyCandidatesToBatch} ready candidates`, questionStance: "organize" });
    }

    const gatedMirror = { claims: gatedClaims };

    // 6c. Validation check.
    const result = validateMirror(gatedMirror, postUpdateBank, config);

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

    const failurePreamble = validationPreamble(failingClaims);
    const clarifyText =
      tentativeBlocked
        ? "I think this may be something to carry forward, but it still sounds tentative - what would make it feel firm enough?"
        : weakestSpan != null
        ? `${failurePreamble ?? "I think you're pointing at something to carry forward, but I can't place it cleanly yet."} when you said "${weakestSpan.userPhrase}", what did you mean by that?`
        : `${failurePreamble ?? "I think you're pointing at something to carry forward, but I can't place it cleanly yet."} can you say a little more?`;

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

