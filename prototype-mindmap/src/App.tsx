import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { compareAssistanceLevels, historyForCurrentTurn, makeLLM, segmentUserTurns, type ConversationMessage, type LevelComparisonResult } from "./api";
import { defaultConfig, withQuestionIntentBias, type MindmapConfig } from "./config";
import type { AssistantResponse, ConversationState, DiagnosticEvent, TurnResult } from "./assistant-response";
import type { ProposalOutcomeContext, QuestionStance, SelectedFocusContext, UserRequestedMode } from "./llm-contract";
import { pruneContextSelection, ThoughtMap, toggleContextSelection, type CoachDebugInfo, type MapCommandAcknowledgement } from "./Map";
import { ThoughtUnitStore, type ThoughtUnitStoreSnapshot } from "./map-store";
import { applyConfirmedReflection, applyGatewayActions, executeCanvasAction, inspectAction, type ProposedAction } from "./action-gateway";
import { createProposalStore, resolveProposal, updateProposal, type Proposal } from "./proposal-store";
import { buildContext, cloneConversationState, createConversationState, mergeConversationBank, processTurn } from "./stage1-loop";
import { cardRef } from "./store";
import type { ThoughtUnit, ThoughtUnitRole } from "./types";
import type { ClaimValidation, ConfirmedReflection, MirrorReflection } from "./types";
import { validateMirror } from "./validator";
import type { ParkedThread } from "./open-threads";
import { buildDiagnosticSnapshot, type SafetyCheck, type TrackedIdea, type UnderhoodEvent, type UnderstandingSnapshot } from "./understanding";
import { useSpeechToText } from "./useSpeechToText";
import { ASSISTANCE_CONTRACTS, contractForLevel, DEFAULT_ASSISTANCE_CONTRACT, normalizeInfluenceTrace, snapshotContract, type AssistanceLevel } from "./assistance-contract";
import { EventLedger, mirrorSanitizedEvent, type LedgerEventKind } from "./event-ledger";
import { effectiveLanguage, isReadOnlyView, languageLabel, languageOptions, restoreLanguageState, selectViewLanguage, setWriteLanguage, type LanguageOption, type LanguageState } from "./language";
import { translateContent } from "./translate";
import { useInterfaceLanguage } from "./dom-translation";
import { openAiEngine } from "./translation-engine";
import { TranslationContext } from "./translation-context";

const LANGUAGE_PICKER_OPTIONS = languageOptions();

/** "Chinese (中文)" — the autonym helps writers find their own language. */
function optionText(option: LanguageOption): string {
  return option.nativeLabel && option.nativeLabel !== option.label
    ? `${option.label} (${option.nativeLabel})`
    : option.label;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  text: string;
  mode?: "question" | "mirror" | "clarify";
  /** A typed proposal awaiting an explicit UI decision. */
  proposalId?: string;
  /** v1/v2 migration input only. */
  mirrorId?: string;
  /** Verbatim draft substring this question is anchored to, if any. */
  questionAnchor?: string;
  /** The coaching stance the AI chose for this turn, if any. */
  questionStance?: QuestionStance;
  /** Preserves the typed response kind for visible provenance in the transcript. */
  responseKind?: AssistantResponse["kind"];
  /** Assistance level active when this user turn was sent (for the recap's dominant/current level). */
  level?: AssistanceLevel;
  /** Read-only 3-level comparison preview (one answer per contract), if a compare turn. */
  comparison?: LevelComparisonResult[];
  /** The user turn this comparison answered — replayed when the user picks a level to continue. */
  comparisonUserText?: string;
}

/**
 * Deterministic session recap (Control Room "Recap" view). Serves both the writer
 * (their own thinking, in order + what they built) and a teacher (authorship split
 * + AI usage). Computed from live state, not the ledger — no AI, no paraphrase.
 */
interface RecapData {
  turnCount: number;
  /** The level the writer spent the most turns under. */
  dominantLevelLabel: string;
  /** The level active right now. */
  currentLevelLabel: string;
  /** True when the writer used more than one level (so we show dominant → now). */
  levelSwitched: boolean;
  cardsTotal: number;
  yourCards: number;
  aiCards: number;
  /** Suggestions the coach offered (L2 only, response kind "suggestion"). */
  suggestionsOffered: number;
  connectionCount: number;
  /** The user's own utterances, in order — their thinking trajectory. */
  timeline: string[];
  /** Per user turn: their words + what the coach offered just before it. */
  turnBeats: Array<{ text: string; coachKind?: string }>;
  /** Cards on the map with provenance (yours vs AI-originated). */
  built: Array<{ text: string; ai: boolean }>;
}

/** One focus episode in the thinking-trajectory timeline (Recap). */
interface ThinkingSegment {
  /** 1-based inclusive turn range this episode spans. */
  start: number;
  end: number;
  /** The user's own verbatim words — extractive, never AI paraphrase. */
  label: string;
  /** Smaller ideas the writer raised under this big idea — also verbatim, extractive. */
  subIdeas: string[];
  /** What the coach offered just before this episode (its response kind). */
  coachKind?: string;
  /** Best-effort: this episode's wording landed on the map. */
  onMap: boolean;
  /** The matched card was AI-originated (the user took the AI's wording). */
  aiOrigin?: boolean;
}

/** First `count` words of a string, with an ellipsis if truncated. */
function firstWords(text: string, count: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const slice = words.slice(0, count).join(" ");
  return words.length > count ? `${slice}…` : slice;
}

/** Bare agreement/negation words that carry no idea on their own. */
const TRIVIAL_SUBIDEA_WORDS = new Set([
  "yes", "no", "ok", "okay", "yeah", "yep", "yup", "nope", "nah", "sure", "maybe", "right", "correct",
]);

/** A sub-idea is trivial if it's under 3 words or just a bare yes/no-type word. */
function isTrivialSubIdea(text: string): boolean {
  const words = text.trim().replace(/[.,!?;:]+$/g, "").split(/\s+/).filter(Boolean);
  if (words.length < 3) return true;
  return words.every((word) => TRIVIAL_SUBIDEA_WORDS.has(word.toLowerCase()));
}

/** Collapsible list of an episode's smaller ideas — hidden until clicked to keep the trail scannable. */
function RecapSubIdeas({ subIdeas }: { subIdeas: string[] }): ReactNode {
  const [open, setOpen] = useState(false);
  if (subIdeas.length === 0) return null;
  return (
    <div className="recap-trail-subwrap">
      <button type="button" className="recap-trail-subtoggle" onClick={() => setOpen((value) => !value)}>
        {open ? "▾" : "▸"} {subIdeas.length} smaller idea{subIdeas.length > 1 ? "s" : ""}
      </button>
      {open && (
        <ul className="recap-trail-subideas">
          {subIdeas.map((sub, index) => (
            <li key={index}>{sub}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Human label for what the coach offered before an episode (recap trajectory). */
function coachMoveLabel(kind?: string): string | undefined {
  switch (kind) {
    case "question": return "asked a question";
    case "reflection": return "mirrored your words";
    case "options": return "offered your own phrases";
    case "suggestion": return "suggested an idea";
    case "map_proposal": return "proposed structure";
    case "aside": return "noted";
    case "compare": return "compared 3 levels";
    default: return undefined;
  }
}

interface DraftPanelPos { x: number; y: number; }
interface DraftPanelSize { w: number; h: number; }

interface MapUndoSnapshot {
  map: ThoughtUnitStoreSnapshot;
  bank: ReturnType<ConversationState["bank"]["getAll"]>;
}

type ClaimDecision = "pending" | "confirmed" | "declined";

export interface MirrorDecisionResolution {
  nextDecisions: Record<string, ClaimDecision>;
  allDecided: boolean;
  anyConfirmed: boolean;
  anyDeclined: boolean;
  shouldContinue: boolean;
}

export function resolveMirrorDecision(
  decisions: Record<string, ClaimDecision>,
  claimId: string,
  decision: "confirmed" | "declined",
): MirrorDecisionResolution {
  const nextDecisions = { ...decisions, [claimId]: decision };
  const nextValues = Object.values(nextDecisions);
  const allDecided = nextValues.every((d) => d !== "pending");
  const anyConfirmed = nextValues.some((d) => d === "confirmed");
  const anyDeclined = nextValues.some((d) => d === "declined");

  return {
    nextDecisions,
    allDecided,
    anyConfirmed,
    anyDeclined,
    shouldContinue: allDecided && anyConfirmed && !anyDeclined,
  };
}

const DRAFT_MARGIN = 12;
const DRAFT_HEADER_HEIGHT = 40;
const DRAFT_MIN_VISIBLE_WIDTH = 220;
const DRAFT_MIN_VISIBLE_HEIGHT = 120;
const DRAFT_CHIP_WIDTH = 56;
const DRAFT_CHIP_HEIGHT = 44;
const SESSION_STORAGE_KEY = "prototype-mindmap-session-v1";

// The Think<->Map slider snaps to five fixed stops. Initial/persisted values (which
// predate snapping, or a legacy default like 35) are snapped to the nearest stop
// so behavior starts on a real mode instead of an off-tick position.
const QUESTION_BIAS_STOPS = [0, 25, 50, 75, 100] as const;
function snapQuestionBias(value: number): number {
  return QUESTION_BIAS_STOPS.reduce(
    (best, stop) => (Math.abs(stop - value) < Math.abs(best - value) ? stop : best),
    QUESTION_BIAS_STOPS[0] as number,
  );
}

export interface PersistedPendingMirror {
  id: string;
  reflection: MirrorReflection;
  claims: ClaimValidation[];
  decisions: Record<string, ClaimDecision>;
  editedTexts?: Record<string, string>;
}

interface PersistedSession {
  version: 1 | 2 | 3 | 4 | 5 | 6;
  sessionId?: string;
  assistanceLevel?: AssistanceLevel;
  /** Absent until the writer picks one; those sessions resume on a fresh guess. */
  writingLanguage?: string;
  msgs: ChatMsg[];
  pendingMirrors?: PersistedPendingMirror[];
  proposals?: Proposal[];
  confirmed: ConfirmedReflection[];
  lastCoachDebug?: CoachDebugInfo | null;
  understandingSnapshot?: UnderstandingSnapshot | null;
  mapRevision: number;
  questionBias: number;
  requireConnectionLabel?: boolean;
  draftText: string;
  draftHtml?: string;
  draftCollapsed: boolean;
  draftDocked?: boolean;
  draftPos: DraftPanelPos;
  draftSize: DraftPanelSize;
  stickyDraftFocus?: DraftSelectionFocus;
  conversation?: {
    turnsSinceLastReflection: number;
    lastAssistantText: string;
    draft: string;
    dismissedCandidateIds: string[];
    openThreads?: ParkedThread[];
  };
  /** Read only by the v1/v2 migration and never restored into live routing state. */
  controller?: { turnsSinceLastMirror?: number; lastAiText?: string; draft?: string; dismissedCandidateIds?: string[]; openThreads?: ParkedThread[] };
  diagnostics?: DiagnosticEvent[];
  bank: ReturnType<ConversationState["bank"]["getAll"]>;
  candidates: ReturnType<ConversationState["candidates"]["getAll"]>;
  map: ThoughtUnitStoreSnapshot;
}

export function migrateLegacyMirrors(pending: PersistedPendingMirror[], mapRevision: number): Proposal[] {
  return pending.map((mirror) => ({
    id: mirror.id,
    mapRevision,
    referencedCardIds: [],
    origin: "unresolved",
    contract: snapshotContract(DEFAULT_ASSISTANCE_CONTRACT),
    state: "invalidated",
    invalidReason: "This earlier-version reflection must be created again under the current assistance contract.",
    detail: { kind: "reflection", reflection: mirror.reflection, claims: mirror.claims, decisions: mirror.decisions, editedTexts: mirror.editedTexts ?? Object.fromEntries(mirror.reflection.claims.map((claim) => [claim.id, claim.text])) },
  }));
}

interface DraftSelectionFocus { text: string; }

// ---------------------------------------------------------------------------
// Styles (no build step needed, just a style tag approach via CSS-in-JS)
// ---------------------------------------------------------------------------

const css = `
  /* One source of truth for the three levels: the picker and the comparison
     cards must agree on sight, so neither hard-codes a hue. \`-ink\` is a
     readable-as-text variant; \`-ring\` the same hue at a border's alpha.
     Framing stays out of this palette — it is one continuum, not a fourth level. */
  :root {
    --level-0: #1a6fa3;
    --level-0-ink: #1a6fa3;
    --level-0-soft: #eef5fb;
    --level-0-ring: rgba(26, 111, 163, 0.32);
    --level-1: #b58f3a;
    --level-1-ink: #8a6a1e;
    --level-1-soft: #fbf5e9;
    --level-1-ring: rgba(181, 143, 58, 0.42);
    --level-2: #8a4bb0;
    --level-2-ink: #8a4bb0;
    --level-2-soft: #f5eefa;
    --level-2-ring: rgba(138, 75, 176, 0.32);

    --framing: #1c7167;
    --framing-pale: #a8ccc6;
    --framing-track: #d2dae5;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f5f4f0;
    color: #191a1b;
    height: 100vh;
    overflow: hidden;
  }

  #root { height: 100vh; display: flex; }

  .layout {
    display: flex;
    width: 100%;
    height: 100vh;
    gap: 0;
  }

  /* ---- chat panel ---- */
  .chat-panel {
    display: flex;
    flex-direction: column;
    width: 420px;
    min-width: 340px;
    background: #fff;
    border-right: 1px solid #d2dae5;
    height: 100vh;
  }

  /* Two stacked control blocks, each a label row over its control. Nothing
     wraps: the widths are the panel's, not the content's. */
  .chat-header {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px 14px;
    border-bottom: 1px solid #d2dae5;
    background: linear-gradient(#f9fafc, #f1f3f6);
    flex-shrink: 0;
  }

  .control-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .control-block-head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 16px;
  }
  .control-block-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: #798ab7;
  }
  .control-block-note {
    font-size: 10.5px;
    line-height: 1.35;
    color: #7a8390;
  }

  /* ---- assistance level: three segments, one lit ---- */
  .segmented {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    padding: 3px;
    border: 1px solid #d2dae5;
    border-radius: 10px;
    background: #f7f8fa;
  }
  .segmented-option {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 5px 4px 6px;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: #7a8390;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  }
  .segmented-option:hover:not(.is-active) { background: rgba(255, 255, 255, 0.7); color: #596370; }
  .segmented-option:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(26, 111, 163, 0.28);
  }
  .segmented-rank {
    font-size: 8.5px;
    font-weight: 800;
    letter-spacing: 0.08em;
    color: #98a4c7;
    transition: color 0.15s;
  }
  .segmented-name {
    font-size: 10.5px;
    font-weight: 650;
    line-height: 1.2;
    text-align: center;
  }
  /* Underline in the level's colour, so the live one reads by more than a tint. */
  .segmented-option::after {
    content: "";
    display: block;
    width: 0;
    height: 2px;
    margin-top: 3px;
    border-radius: 99px;
    background: currentColor;
    opacity: 0;
    transition: width 0.18s ease, opacity 0.18s ease;
  }
  .segmented-option.is-active::after { width: 18px; opacity: 1; }

  /* Each level tints in its own hue, so the whole block shifts with the level. */
  .segmented-option.is-active {
    background: #fff;
    box-shadow: 0 1px 2px rgba(40, 35, 25, 0.1);
  }
  .segmented-option.is-active[data-level="0"] {
    background: var(--level-0-soft);
    color: var(--level-0-ink);
    box-shadow: inset 0 0 0 1px var(--level-0-ring), 0 1px 2px rgba(40, 35, 25, 0.08);
  }
  .segmented-option.is-active[data-level="1"] {
    background: var(--level-1-soft);
    color: var(--level-1-ink);
    box-shadow: inset 0 0 0 1px var(--level-1-ring), 0 1px 2px rgba(40, 35, 25, 0.08);
  }
  .segmented-option.is-active[data-level="2"] {
    background: var(--level-2-soft);
    color: var(--level-2-ink);
    box-shadow: inset 0 0 0 1px var(--level-2-ring), 0 1px 2px rgba(40, 35, 25, 0.08);
  }
  .segmented-option.is-active .segmented-rank { color: inherit; opacity: 0.75; }
  .segmented-option.is-active .segmented-name { font-weight: 700; }

  /* ---- Think/Map rail ---- */
  .bias-rail {
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 10px;
    font-size: 10px;
    font-weight: 650;
    color: #7a8390;
  }
  /* Ends stay muted until steered toward; at the midpoint neither lights up. */
  .bias-end { user-select: none; color: #919fc4; transition: color 0.15s; }

  .bias-track {
    position: relative;
    display: block;
    height: 18px;
  }
  /* Full ramp painted across the track, then the unfilled part covered over, so
     the fill edge's depth is the position. A fill-sized gradient would squeeze
     to the deepest shade at every stop. */
  .bias-track::before {
    content: "";
    position: absolute;
    z-index: 0;
    left: 0;
    right: 0;
    top: 50%;
    height: 5px;
    transform: translateY(-50%);
    border-radius: 99px;
    background: linear-gradient(90deg, var(--framing-pale) 0%, var(--framing) 100%);
  }
  .bias-track::after {
    content: "";
    position: absolute;
    z-index: 0;
    left: var(--bias-fill);
    right: 0;
    top: 50%;
    height: 5px;
    transform: translateY(-50%);
    border-radius: 99px;
    background: var(--framing-track);
    transition: left 0.15s ease;
  }
  .bias-ticks {
    position: absolute;
    z-index: 1;
    inset: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0 1px;
    pointer-events: none;
  }
  .bias-tick {
    width: 3px;
    height: 3px;
    border-radius: 99px;
    background: #b8c5d6;
    transition: background 0.15s;
  }
  .bias-tick.is-passed { background: rgba(255, 255, 255, 0.9); }
  .bias-track input[type="range"] {
    position: relative;
    z-index: 2;
    width: 100%;
    height: 18px;
    margin: 0;
    background: transparent;
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
  }
  .bias-track input[type="range"]::-webkit-slider-runnable-track { height: 18px; background: transparent; }
  .bias-track input[type="range"]::-moz-range-track { height: 18px; background: transparent; }
  .bias-track input[type="range"]::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: 2px;
    border: 2px solid var(--framing);
    border-radius: 99px;
    background: #fff;
    box-shadow: 0 1px 3px rgba(20, 60, 90, 0.28);
    transition: transform 0.12s;
  }
  .bias-track input[type="range"]::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border: 2px solid var(--framing);
    border-radius: 99px;
    background: #fff;
    box-shadow: 0 1px 3px rgba(20, 60, 90, 0.28);
  }
  .bias-track input[type="range"]:hover::-webkit-slider-thumb { transform: scale(1.12); }
  .bias-track input[type="range"]:focus-visible::-webkit-slider-thumb {
    box-shadow: 0 0 0 4px rgba(28, 113, 103, 0.24);
  }

  /* Only the end actually being steered toward takes the framing colour. */
  .control-block[data-stop="0"]   .bias-end-think,
  .control-block[data-stop="25"]  .bias-end-think,
  .control-block[data-stop="75"]  .bias-end-map,
  .control-block[data-stop="100"] .bias-end-map { color: var(--framing); }

  /* ---- language pickers, in the map tools ----
     One grouped control, not two loose dropdowns: a rounded shell, two
     borderless selects split by a divider. Pen = the writer's source language,
     eye = the read-only translated view over it. */
  .language-bar {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 5px;
    border: 1px solid #cbd4e1;
    border-radius: 8px;
    background: #fff;
    transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
  }
  .lang-field {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0 3px;
    color: #8a93a1;
  }
  .lang-field-icon {
    display: flex;
    width: 13px;
    height: 13px;
  }
  .lang-field select {
    appearance: none;
    -webkit-appearance: none;
    border: 0;
    border-radius: 5px;
    background-color: transparent;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5L5 6.5L8 3.5' fill='none' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 4px center;
    padding: 4px 18px 4px 4px;
    font-size: 12px;
    font-weight: 600;
    color: #212933;
    cursor: pointer;
    transition: background-color 0.15s;
  }
  .lang-field select:hover:not(:disabled) { background-color: #eef2f7; }
  .lang-field.is-locked { color: #aeb5bf; }
  .lang-field select:disabled {
    color: #8d95a1;
    cursor: not-allowed;
    background-image: none;
    padding-right: 4px;
  }
  .lang-field select:focus-visible {
    outline: none;
    background-color: #eef2f7;
    box-shadow: 0 0 0 2px rgba(26, 111, 163, 0.3);
  }
  .lang-divider {
    width: 1px;
    height: 16px;
    margin: 0 3px;
    background: #e2e8f0;
  }
  /* Translation is a whole-page state, so the whole control shifts to amber. */
  .language-bar.is-translated {
    border-color: #e0c98a;
    background: #fdf9ee;
  }
  .language-bar.is-translated .lang-field-view { color: #b07a2a; }
  .language-bar.is-translated .lang-field-view select {
    color: #8a5a1f;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5L5 6.5L8 3.5' fill='none' stroke='%23b07a2a' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  }
  .language-bar.is-translated .lang-field-view select:hover { background-color: #f7edd6; }

  .stance-chip {
    margin-left: 6px;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 99px;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    background: #e5eaf0;
    color: #758191;
  }
  .stance-chip.stance-settle    { background: #eef6fb; color: #3b7ea8; }
  .stance-chip.stance-narrow    { background: #fdf3e7; color: #b07a2a; }
  .stance-chip.stance-deepen    { background: #eef7f0; color: #2f8a52; }
  .stance-chip.stance-organize  { background: #f0eefb; color: #6a55b0; }
  .stance-chip.stance-challenge { background: #fdeeee; color: #b0463f; }

  .messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px 14px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .msg {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 92%;
  }
  .msg.user  { align-self: flex-end; align-items: flex-end; }
  .msg.assistant { align-self: flex-start; align-items: flex-start; }

  .msg-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #999;
  }
  .ai-suggestion-badge {
    display: inline-block;
    margin-left: 5px;
    padding: 2px 5px;
    border: 1px solid #c9b3e7;
    border-radius: 8px;
    background: #f1e7ff;
    color: #70459a;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.02em;
    text-transform: none;
  }
  .focus-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0 10px 6px;
    padding: 5px 8px;
    border: 1px solid #bfd8e8;
    border-radius: 8px;
    background: #f2f8fb;
    color: #385a6f;
    font-size: 11px;
    line-height: 1.3;
  }
  .focus-chip-text { flex: 1; min-width: 0; }
  .focus-chip-dismiss,
  .anchor-view-btn {
    border: 1px solid #bdd5e4;
    border-radius: 6px;
    background: #fff;
    color: #23678f;
    cursor: pointer;
    font-size: 10px;
    font-weight: 700;
    padding: 3px 6px;
  }
  .anchor-view-btn { margin-top: 5px; }

  .msg-bubble {
    padding: 9px 13px;
    border-radius: 14px;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  .msg.user .msg-bubble {
    background: #1a6fa3;
    color: #fff;
    border-bottom-right-radius: 4px;
  }
  .msg.assistant .msg-bubble {
    background: #f7f8fa;
    color: #191a1b;
    border-bottom-left-radius: 4px;
  }
  .msg.assistant.mirror .msg-bubble  { background: #e8f8ed; }
  .msg.assistant.clarify .msg-bubble { background: #fff3e0; }

  /* ---- assistance-contract comparison toggle + 3-level preview ---- */
  /* Under the segmented control, since it overrides that setting for a turn. */
  .compare-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    padding: 7px 10px;
    border: 1px solid #d2dae5;
    border-radius: 9px;
    background: #f1f3f6;
    color: #7a8390;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s, box-shadow 0.15s;
  }
  .compare-toggle:hover { background: #e9edf2; color: #596370; }
  .compare-toggle.is-active {
    border-color: #cdc4dd;
    background: linear-gradient(90deg, var(--level-0-soft) 0%, var(--level-1-soft) 50%, var(--level-2-soft) 100%);
    color: #404854;
  }
  /* All three level hues at once: the button turns the level into three answers. */
  .compare-toggle.is-active::before {
    content: "";
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 4px;
    height: 2px;
    border-radius: 99px;
    background: linear-gradient(90deg,
      var(--level-0) 0%, var(--level-0) 33%,
      var(--level-1) 33%, var(--level-1) 66%,
      var(--level-2) 66%, var(--level-2) 100%);
  }
  .compare-toggle { position: relative; }
  .compare-toggle:focus-visible {
    outline: none;
    box-shadow: 0 0 0 3px rgba(26, 111, 163, 0.25);
  }
  .compare-toggle-mark { font-size: 12px; line-height: 1; }
  .compare-toggle.is-active .compare-toggle-mark { color: var(--level-1-ink); }
  .compare3 { display: flex; flex-direction: column; gap: 8px; width: 100%; }
  .compare3-card {
    border: 1px solid #d1d9e4;
    border-left: 3px solid #b8c5d6;
    border-radius: 10px;
    background: #fff;
    padding: 8px 12px;
  }
  .compare3-card.level-0 { border-left-color: var(--level-0); }
  .compare3-card.level-1 { border-left-color: var(--level-1); }
  .compare3-card.level-2 { border-left-color: var(--level-2); }
  .compare3-head { display: flex; align-items: center; gap: 7px; margin-bottom: 4px; }
  .compare3-level { font-size: 11px; font-weight: 800; color: #454e5a; }
  .compare3-card.level-0 .compare3-level { color: var(--level-0-ink); }
  .compare3-card.level-1 .compare3-level { color: var(--level-1-ink); }
  .compare3-card.level-2 .compare3-level { color: var(--level-2-ink); }
  .compare3-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #8591a1; }
  .compare3-kind { margin-left: auto; font-size: 10px; color: #8591a1; font-style: italic; }
  .compare3-text { font-size: 14px; line-height: 1.5; white-space: pre-wrap; color: #191a1b; }
  .compare3-options { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .option-chip.static {
    font-size: 13px;
    border: 1px solid #cbd7e2;
    border-radius: 999px;
    background: #f4f9fc;
    color: #1a4e6e;
    padding: 3px 10px;
  }
  .compare3-rej { margin-top: 5px; font-size: 10px; color: #b0491f; }
  .compare3-continue {
    margin-top: 8px;
    border: 1px solid #cbd7e2;
    border-radius: 8px;
    background: #fff;
    color: #1a4e6e;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 4px 12px;
    cursor: pointer;
  }
  .compare3-continue:hover:not(:disabled) { background: #eef5fa; border-color: #9dc0d6; }
  .compare3-continue:disabled { opacity: 0.5; cursor: default; }

  /* ---- mirror confirmation card ---- */
  .mirror-card {
    border: 1.5px solid #b5dfc5;
    border-radius: 12px;
    background: #f4fcf7;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-self: stretch;
    max-width: 100%;
    box-sizing: border-box;
  }

  .mirror-card-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #2a8a50;
  }

  .mirror-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .influence-badge {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 7px;
    border-radius: 8px;
    border: 1px solid #e6c982;
    background: #fdf4dc;
    color: #8a5a12;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
    white-space: nowrap;
    cursor: help;
  }

  .mirror-claims { display: flex; flex-direction: column; gap: 10px; }

  .claim-row {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    font-size: 13px;
    line-height: 1.4;
  }

  .claim-text {
    flex: 1;
    width: 100%;
    box-sizing: border-box;
  }

  .claim-editor {
    min-height: 132px;
    resize: vertical;
    border: 1px solid #cfe8d7;
    border-radius: 8px;
    background: #fff;
    color: #1f2d24;
    padding: 8px 10px;
    font: inherit;
    line-height: 1.4;
    outline: none;
    box-shadow: inset 0 1px 2px rgba(31, 45, 36, 0.04);
  }

  .claim-editor:focus {
    border-color: #2a8a50;
    box-shadow: 0 0 0 2px rgba(42, 138, 80, 0.14);
  }

  .claim-btns {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
    align-self: flex-end;
  }

  .claim-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 99px;
    flex-shrink: 0;
  }
  .claim-badge.confirmed { background: #d4edda; color: #1a7a3c; }
  .claim-badge.declined  { background: #fde8e8; color: #c0392b; }

  .btn {
    font-size: 12px;
    font-weight: 600;
    padding: 6px 14px;
    border-radius: 8px;
    border: none;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn:disabled { opacity: 0.4; cursor: default; }

  .btn-confirm-sm {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    background: #1a7a3c;
    color: #fff;
    transition: opacity 0.15s;
  }
  .btn-confirm-sm:hover { opacity: 0.85; }

  .btn-decline-sm {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid #ddd;
    cursor: pointer;
    background: #f7f8fa;
    color: #555;
    transition: opacity 0.15s;
  }
  .btn-decline-sm:hover { opacity: 0.85; }

  /* ---- input area ---- */
  .input-area {
    border-top: 1px solid #d2dae5;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #f7f8fa;
    flex-shrink: 0;
  }

  .input-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid #c4cedc;
    border-radius: 14px;
    background: #fff;
    padding: 8px;
    box-shadow: 0 1px 2px rgba(30, 28, 24, 0.04);
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .input-row:focus-within {
    border-color: #1a6fa3;
    box-shadow: 0 0 0 2px rgba(26, 111, 163, 0.1);
  }

  /* Writing-language and read-only translation controls */
  .read-only-note {
    margin: 0 0 6px;
    padding: 5px 8px;
    font-size: 11px;
    line-height: 1.4;
    color: #8a5a1f;
    background: #fdf6e3;
    border: 1px solid #e8dcc0;
    border-radius: 4px;
  }
  .translation-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    padding: 6px 10px;
    font-size: 11px;
    line-height: 1.4;
    color: #5a4a2f;
    background: #fdf6e3;
    border-bottom: 1px solid #e8dcc0;
  }
  .translation-banner button {
    flex-shrink: 0;
    padding: 3px 8px;
    font-size: 11px;
    font-weight: 600;
    color: #5a4a2f;
    background: #fff;
    border: 1px solid #d8c9a4;
    border-radius: 4px;
    cursor: pointer;
  }
  .translation-banner button:hover { background: #f7efd9; }
  .draft-editor-translated {
    white-space: pre-wrap;
    cursor: default;
    background: #f7f8fa;
  }

  .composer-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 7px;
    min-height: 32px;
  }
  .composer-left-tools,
  .composer-action-tools {
    display: flex;
    align-items: center;
    gap: 7px;
  }

  .mic-btn,
  .draft-toggle-btn,
  .uth-toggle-btn {
    height: 30px;
    flex: 0 0 auto;
    border: 1px solid transparent;
    border-radius: 999px;
    background: #fff;
    color: #66707d;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: opacity 0.15s, border-color 0.15s, color 0.15s, background 0.15s;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0;
  }
  .mic-btn {
    width: 30px;
    padding: 0;
  }
  .uth-toggle-btn {
    width: auto;
    padding: 0 10px;
    gap: 5px;
  }
  .draft-toggle-btn {
    width: auto;
    padding: 0 11px;
  }
  .mic-btn:hover:not(:disabled),
  .draft-toggle-btn:hover:not(:disabled),
  .uth-toggle-btn:hover:not(:disabled) {
    border-color: #1a6fa3;
    color: #1a6fa3;
    background: #f3f8fb;
  }
  .mic-btn:disabled,
  .draft-toggle-btn:disabled,
  .uth-toggle-btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .mic-btn.live {
    border-color: #c8652f;
    color: #c8652f;
    background: #fff2ea;
  }
  .uth-toggle-btn.active {
    border-color: #2f8f6b;
    color: #1f6b4d;
    background: #eaf7f0;
  }
  .mic-btn svg,
  .uth-toggle-btn svg {
    width: 16px;
    height: 16px;
    stroke-width: 2;
  }

  textarea {
    flex: 1;
    resize: none;
    border: 1px solid #ddd;
    border-radius: 10px;
    padding: 9px 12px;
    font-family: inherit;
    font-size: 14px;
    line-height: 1.4;
    background: #fff;
    outline: none;
    transition: border-color 0.15s;
    max-height: 120px;
    overflow-y: auto;
  }
  textarea:focus { border-color: #1a6fa3; }
  .composer-textarea {
    min-height: 58px;
    max-height: 220px;
    overflow-y: hidden;
    width: 100%;
    border: 0;
    border-radius: 10px;
    padding: 6px 8px;
    background: transparent;
  }
  .composer-textarea:focus {
    border-color: transparent;
  }
  .composer-textarea.composer-scroll {
    overflow-y: auto;
  }

  .send-btn {
    flex: 0 0 auto;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background: #1a6fa3;
    color: #fff;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    transition: opacity 0.15s;
  }
  .send-btn:hover  { opacity: 0.85; }
  .send-btn:disabled { opacity: 0.4; cursor: default; }

  .input-hint {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #aaa;
    line-height: 1.3;
  }
  /* Destructive, so it stays quiet in the composer's corner until pointed at. */
  .clear-chat-btn {
    margin-left: auto;
    padding: 3px 8px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: #919fc4;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
  }
  .clear-chat-btn:hover { border-color: #e6d5d3; background: #fdf4f3; color: #a8564d; }
  .clear-chat-btn:focus-visible {
    outline: none;
    border-color: #d8b4af;
    box-shadow: 0 0 0 3px rgba(168, 86, 77, 0.16);
  }

  /* ---- concept map ---- */
  .map-panel {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
    background: #f5f4f0;
  }

  .map-header {
    min-height: 58px;
    padding: 7px 12px;
    border-bottom: 1px solid #d2dae5;
    background: #f7f8fa;
    flex-shrink: 0;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    column-gap: 10px;
    row-gap: 0;
    transition: background 0.16s ease, box-shadow 0.16s ease, border-color 0.16s ease;
  }
  .map-shell.underhood-open .map-header {
    padding-right: 438px;
  }
  .map-header.draft-dock-target {
    border-bottom-color: #d6a955;
    background: #fff7df;
    box-shadow: inset 0 -3px 0 #d6a955, 0 8px 22px rgba(122, 90, 22, 0.12);
  }

  .map-heading {
    flex: 0 0 auto;
    min-width: 40px;
  }

  .map-count {
    display: block;
    margin-top: 0;
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
    color: #7a8390;
  }

  .map-left-tools,
  .map-right-tools {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: nowrap;
  }
  .map-left-tools,
  .map-right-tools {
    /* A native (non-overlay) horizontal scrollbar takes real height at the
       bottom of the box; with overflow-y hidden that clips into the tallest
       child (the docked draft pill). Reserve scrollbar height as padding, then
       pull it back with a negative margin so it doesn't shift the header
       layout — the scrollbar has room without visible content losing height. */
    padding-bottom: 17px;
    margin-bottom: -17px;
  }
  .map-left-tools {
    justify-self: start;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }
  .map-right-tools {
    justify-self: end;
    justify-content: flex-end;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: thin;
  }

  /* Docked draft keeps the same size and physical affordance as the floating
     chip; it simply snaps into its predefined header slot. */
  .map-draft-slot {
    flex: 0 0 56px;
    width: 56px;
    height: 44px;
    display: grid;
    place-items: center;
    border: 1px dashed #d6c8aa;
    border-radius: 7px;
    background: #f1f3f6;
    color: #a2834e;
    transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
  }

  @media (max-width: 1200px) {
    .map-left-tools,
    .map-right-tools {
      gap: 6px;
    }
  }
  .map-draft-slot.occupied {
    border-style: solid;
    border-color: transparent;
    background: transparent;
  }
  .draft-dock-target .map-draft-slot {
    border-color: #c79740;
    background: #fff1c8;
    box-shadow: inset 0 0 0 2px rgba(199, 151, 64, 0.18);
  }
  .map-draft-slot-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  @media (max-width: 900px) {
    .map-shell.underhood-open .map-header {
      padding-right: 16px;
    }
  }
  .map-draft-dock {
    display: inline-flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 56px;
    height: 44px;
    padding: 0;
    border: 1px solid #d6a955;
    border-radius: 7px;
    background: #f6e8c8;
    color: #7a5a16;
    box-shadow: 0 6px 18px rgba(122, 90, 22, 0.16);
    cursor: pointer;
    user-select: none;
  }
  .map-draft-dock:hover { background: #f6e7bd; border-color: #c79740; }
  .map-draft-dock-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .map-draft-dock-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #1a6fa3;
  }

  .map-command-ack {
    min-width: 0;
    flex: 1 1 170px;
    max-width: min(280px, 100%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 7px 5px 10px;
    border: 1px solid #cfded2;
    border-radius: 7px;
    background: #f1f8f2;
    color: #315d3b;
    font-size: 12px;
    font-weight: 650;
    box-shadow: 0 1px 0 rgba(49, 93, 59, 0.06);
  }
  .map-command-ack span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .map-command-ack button {
    flex-shrink: 0;
    border: 1px solid #b9d2be;
    border-radius: 5px;
    background: #fff;
    color: #315d3b;
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 7px;
  }
  .map-command-ack button:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .map-canvas {
    position: relative;
    flex: 1;
    min-height: 0;
  }

  .map-empty {
    position: absolute;
    z-index: 2;
    left: 50%;
    top: 46%;
    transform: translate(-50%, -50%);
    color: #aaa;
    font-size: 13px;
    font-style: italic;
  }

  .map-card {
    width: 260px;
    min-height: 132px;
    background: #fff;
    border: 1px solid #c9d1dd;
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(30, 30, 30, 0.08);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .map-card.selected {
    border-color: #1a6fa3;
    box-shadow: 0 10px 26px rgba(26, 111, 163, 0.18);
  }

  .map-card.role-content { border-left: 4px solid #b58f3a; }
  .map-card.role-subnode { border-left: 4px solid #1a6fa3; }
  .map-card.role-connection_label { border-left: 4px solid #7a5b99; }

  /* Live drop-target highlight while another card is dragged over this one.
     ReactFlow applies the node className to the .react-flow__node wrapper, so the
     highlight must reach the inner .map-card from there. */
  .react-flow__node.drop-target .map-card {
    border-color: #1a6fa3;
    box-shadow: 0 0 0 3px rgba(26, 111, 163, 0.35), 0 10px 26px rgba(26, 111, 163, 0.22);
    background: #f1f7fb;
  }

  /* Highlight for cards the current coach turn refers to by #ref. */
  .react-flow__node.referenced .map-card {
    border-color: #b58f3a;
    box-shadow: 0 0 0 3px rgba(181, 143, 58, 0.4), 0 10px 26px rgba(181, 143, 58, 0.22);
  }

  .react-flow__node.context-selected .map-card {
    border-color: #b58f3a;
    box-shadow: 0 0 0 3px rgba(181, 143, 58, 0.5), 0 10px 26px rgba(181, 143, 58, 0.24);
    background: #fff9e8;
  }

  .map-card-close {
    position: absolute;
    top: 5px;
    right: 5px;
    z-index: 6;
    width: 20px;
    height: 20px;
    padding: 0;
    line-height: 1;
    border: 1px solid #d2dae5;
    border-radius: 5px;
    background: #f7f8fa;
    color: #707e92;
    cursor: pointer;
    font-size: 12px;
  }
  .map-card-close:hover {
    background: #f5d9d4;
    border-color: #d99b8f;
    color: #9a3b2a;
  }

  .map-card-drag {
    min-height: 30px;
    padding: 7px 28px 7px 9px;
    background: #f7f8fa;
    border-bottom: 1px solid #d2dae5;
    cursor: grab;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .map-card-drag:active { cursor: grabbing; }

  /* Four-dot grip: an obvious grab target at the card's top-left. It lives inside
     the drag bar (the React Flow dragHandle), so dragging works no matter what the
     card body holds - editable text, nested cards, scrollable content, buttons. */
  .map-drag-grip {
    flex: 0 0 auto;
    width: 10px;
    height: 10px;
    color: #929fb1;
    background-image: radial-gradient(currentColor 1.1px, transparent 1.4px);
    background-size: 5px 5px;
    background-position: 0 0;
  }
  .map-card-drag:hover .map-drag-grip { color: #697484; }

  .map-role-chip {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #57616e;
  }

  .map-card-editor {
    width: 100%;
    min-height: 64px;
    max-height: 120px;
    border: 0;
    border-radius: 0;
    padding: 9px 10px;
    resize: none;
    font-size: 13px;
    line-height: 1.45;
    color: #222;
    background: #fff;
  }
  .map-card-editor:focus {
    outline: none;
    background: #f9fafc;
  }

  .map-card-actions {
    min-height: 22px;
    padding: 3px 8px 4px;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .map-card-actions button,
  .map-undo,
  .map-clean,
  .map-clear-draft,
  .map-clear-map,
  .connection-panel button {
    border: 1px solid #c9d1dd;
    border-radius: 6px;
    background: #fff;
    color: #404854;
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    padding: 4px 8px;
  }

  .map-source-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #1a7a3c;
    margin-left: auto;
  }
  .map-origin-badge { padding: 2px 5px; border-radius: 8px; background: #f1e7ff; color: #70459a; font-size: 10px; font-weight: 700; }

  .map-handle {
    width: 9px;
    height: 9px;
    background: #1a6fa3;
    border: 2px solid #fff;
    opacity: 0;
    transition: opacity 0.12s, transform 0.12s;
  }
  /* Invisible anchor node standing in for a nested connection endpoint. It
     exists only so the edge attaches at the embedded card's position - never
     visible, never interactive. */
  .map-proxy-anchor {
    width: 100%;
    height: 100%;
    opacity: 0;
    pointer-events: none;
  }
  .map-proxy-anchor .map-handle {
    pointer-events: none;
  }
  .map-card:hover .map-handle,
  .map-card.selected .map-handle {
    opacity: 1;
  }
  .map-handle-top,
  .map-handle-bottom {
    background: #4f8c6b;
  }
  .map-handle-left,
  .map-handle-right {
    background: #1a6fa3;
  }
  .map-handle-source {
    z-index: 7;
    box-shadow: 0 0 0 2px rgba(255,255,255,0.9);
  }
  .map-handle-target {
    z-index: 6;
    width: 15px;
    height: 15px;
    background: transparent;
    border: 1px dashed rgba(26, 111, 163, 0.55);
  }
  .map-handle-source:hover {
    transform: scale(1.35);
  }
  .map-handle-corner {
    width: 8px;
    height: 8px;
  }

  .map-resize-edge,
  .map-resize-corner {
    position: absolute;
    z-index: 5;
    opacity: 0;
    background: rgba(26, 111, 163, 0.14);
    transition: opacity 0.12s;
    /* Keep a resize drag from selecting card text or starting a touch scroll. */
    user-select: none;
    touch-action: none;
  }
  .map-card:hover .map-resize-edge,
  .map-card:hover .map-resize-corner,
  .map-card.selected .map-resize-edge,
  .map-card.selected .map-resize-corner {
    opacity: 1;
  }
  .map-resize-n,
  .map-resize-s {
    left: 16px;
    right: 16px;
    height: 10px;
    cursor: ns-resize;
  }
  .map-resize-n { top: 0; }
  .map-resize-s { bottom: 0; }
  .map-resize-e,
  .map-resize-w {
    top: 16px;
    bottom: 16px;
    width: 10px;
    cursor: ew-resize;
  }
  .map-resize-e { right: 0; }
  .map-resize-w { left: 0; }
  .map-resize-corner {
    width: 16px;
    height: 16px;
  }
  .map-resize-nw { top: 0; left: 0; cursor: nwse-resize; }
  .map-resize-ne { top: 0; right: 0; cursor: nesw-resize; }
  .map-resize-se { right: 0; bottom: 0; cursor: nwse-resize; }
  .map-resize-sw { left: 0; bottom: 0; cursor: nesw-resize; }

  .map-edge path {
    stroke: #4f6d7a;
    stroke-width: 2;
  }
  .react-flow__edgeupdater {
    fill: rgba(79, 109, 122, 0.22);
    stroke: rgba(255, 255, 255, 0.95);
    stroke-width: 2;
    opacity: 0;
    transition: opacity 0.12s;
    cursor: grab;
  }
  .react-flow__edge:hover .react-flow__edgeupdater,
  .react-flow__edge.selected .react-flow__edgeupdater {
    opacity: 1;
  }
  .react-flow__edgeupdater:active {
    cursor: grabbing;
  }
  .map-edge.pending path {
    stroke-dasharray: 6 5;
  }

  .connection-panel {
    position: absolute;
    z-index: 8;
    right: 16px;
    background: #fff;
    border: 1px solid #c9d1dd;
    border-radius: 8px;
    box-shadow: 0 12px 30px rgba(30, 30, 30, 0.12);
  }

  .connection-panel {
    top: 16px;
    width: min(320px, calc(100% - 32px));
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  @keyframes connection-panel-pulse {
    0% { box-shadow: 0 0 0 0 rgba(26, 111, 163, 0.38), 0 12px 30px rgba(30, 30, 30, 0.12); }
    40% { box-shadow: 0 0 0 6px rgba(26, 111, 163, 0.18), 0 12px 30px rgba(30, 30, 30, 0.16); }
    100% { box-shadow: 0 0 0 0 rgba(26, 111, 163, 0), 0 12px 30px rgba(30, 30, 30, 0.12); }
  }
  .connection-panel.blink {
    animation: connection-panel-pulse 0.9s ease-out 1;
  }

  .connection-panel-meta {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 6px;
    align-items: center;
    font-size: 11px;
    font-weight: 700;
    color: #57616e;
  }
  .connection-panel-meta span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .connection-input {
    width: 100%;
    min-height: 66px;
    max-height: 120px;
    font-size: 13px;
  }

  .connection-actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  /* ---- connection edge badge ---- */
  /* The edge-label layer must sit above cards so an open direction popover is
     never covered. Collapsed badges are small and transparent-backed, so this
     does not visually collide with card bodies. */
  .react-flow__edgelabel-renderer { z-index: 6; }
  .edge-badge-wrap {
    position: absolute;
    pointer-events: all;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    z-index: 5;
  }
  .edge-badge-wrap.open { z-index: 1200; }
  .edge-badge {
    width: 27px;
    height: 27px;
    border-radius: 50%;
    border: 1px solid #b7c1cf;
    background: #fff;
    color: #596370;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .edge-badge:hover { background: #ebeff4; }
  .edge-badge.active {
    background: #191a1b;
    color: #fff;
    border-color: #191a1b;
    box-shadow: 0 0 0 3px rgba(26,26,26,0.18);
  }
  .edge-move-hint {
    font-size: 11px;
    color: #a6b1c0;
  }
  .edge-direction {
    display: grid;
    gap: 5px;
  }
  .edge-direction-title {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #a6b1c0;
  }
  .edge-direction-buttons {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .edge-direction-buttons button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    border: 1px solid #42474d;
    border-radius: 6px;
    background: #242a32;
    color: #ebeff4;
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 8px;
    text-align: left;
  }
  .edge-direction-buttons button:hover { background: #343638; }
  .edge-direction-buttons button.active {
    background: #ebeff4;
    color: #191c21;
    border-color: #ebeff4;
  }
  .edge-direction-glyph { font-size: 15px; width: 16px; text-align: center; }
  .edge-direction-label { flex: 1; }
  .edge-popover {
    position: absolute;
    bottom: calc(100% + 14px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 1200;
    pointer-events: all;
    display: flex;
    flex-direction: column;
    gap: 7px;
    width: 230px;
    max-width: 230px;
    background: #191a1b;
    color: #fff;
    font-size: 12px;
    line-height: 1.4;
    padding: 9px 11px;
    border-radius: 8px;
    box-shadow: 0 8px 22px rgba(0,0,0,0.34);
  }
  /* Bright tether from the on-edge badge up to the floating popover. */
  .edge-popover::after {
    content: "";
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    width: 2px;
    height: 14px;
    background: #f0b429;
  }
  .edge-popover-cards {
    display: grid;
    gap: 3px;
  }
  .edge-popover-card {
    font-size: 11.5px;
    color: #d2dae5;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .edge-popover-card b { color: #f0b429; margin-right: 4px; }
  .edge-popover-text {
    font-style: italic;
    color: #c9d2de;
    border-top: 1px solid #333;
    padding-top: 6px;
  }
  .edge-delete {
    font-size: 11px;
    font-weight: 600;
    padding: 3px 8px;
    border-radius: 5px;
    border: none;
    background: #6e2b27;
    color: #fff;
    cursor: pointer;
  }
  .edge-delete:hover { background: #8a352f; }

  /* ---- map header extras ---- */
  .map-clear-draft,
  .map-add-card {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #b5dfc5;
    background: #eafaf0;
    color: #1a7a3c;
    cursor: pointer;
  }
  /* Amber: these buttons are colour-coded by action, so they keep their warmth
     while the surrounding neutrals go cool. */
  .map-clear-draft {
    border-color: #ddd3bf;
    background: #f8f4ea;
    color: #705d36;
  }
  .map-clear-draft:hover { background: #f0e7d3; }
  .map-add-card:hover { background: #dcf4e6; }

  .map-label-toggle {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 6px;
    border: 1px solid #c9d1dd;
    background: #fff;
    color: #4f5864;
    cursor: pointer;
  }
  .map-label-toggle.active {
    border-color: #b5dfc5;
    background: #eafaf0;
    color: #1a7a3c;
  }
  .map-label-toggle:hover { background: #ebeff4; }
  .map-label-toggle.active:hover { background: #dcf4e6; }

  .map-undo,
  .map-clean,
  .map-clear-map {
    font-size: 11px;
    padding: 4px 8px;
  }
  .map-clear-map {
    border-color: #ead3cf;
    background: #fff7f5;
    color: #8a4f45;
  }
  .map-clear-map:hover { background: #fdecea; }
  .map-undo:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .map-hint {
    font-size: 11px;
    color: #8591a1;
    padding: 4px 16px 0;
    line-height: 1.4;
  }

  /* ---- nested (embedded) cards ---- */
  /* A card with children grows to fit them (height:auto in JS), so it must not
     clip its content the way a fixed-size childless card does. */
  .map-card.has-children {
    background: #f9fafc;
    border-color: #b8c4d5;
    overflow: visible;
  }
  /* Parent (title) cards don't need the tall typing area or the spacer action
     row a standalone card has. Drop the action row entirely so the only
     separation between the parent's text and its members is the members'
     container border. */
  .map-card.has-children .map-card-editor {
    min-height: 34px;
  }
  .map-card.has-children .map-card-actions {
    display: none;
  }
  .map-card-children {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 0;
    padding: 14px 8px 8px 18px;
    border-top: 1px solid #cad3e0;
    border-left: 2px solid #cad3e0;
    margin-left: 8px;
    background: #f7f8fa;
  }
  .map-embed {
    position: relative;
    border: 1px solid #cad3e0;
    border-left: 3px solid #7d8ea7;
    border-radius: 5px;
    background: #fff;
    padding: 8px 8px 5px 22px;
    cursor: grab;
  }
  .map-embed:active {
    cursor: grabbing;
  }
  .map-embed.dragging {
    opacity: 0.55;
    border-style: dashed;
  }
  .map-embed.role-subnode { border-left-color: #1a6fa3; }
  .map-embed-drag-grip {
    position: absolute;
    top: 9px;
    left: 7px;
    width: 10px;
    height: 10px;
    color: #929fb1;
    background-image: radial-gradient(currentColor 1.1px, transparent 1.4px);
    background-size: 5px 5px;
    background-position: 0 0;
    cursor: grab;
  }
  .map-embed:hover .map-embed-drag-grip { color: #697484; }
  .map-embed-drag-grip:active { cursor: grabbing; }
  .map-embed-editor {
    width: 100%;
    border: none;
    outline: none;
    resize: none;
    background: transparent;
    font-family: inherit;
    font-size: 12px;
    line-height: 1.4;
    color: #191a1b;
    cursor: text;
  }
  .map-embed.expanded .map-embed-editor {
    max-height: none;
    overflow: hidden;
  }
  .map-embed-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
    row-gap: 4px;
    margin-top: 6px;
  }
  .map-embed-ref {
    flex: 1 1 64px;
    font-size: 10px;
    font-weight: 700;
    color: #7f8997;
  }
  .map-embed-actions button {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 5px;
    border: 1px solid #c9d1dd;
    background: #ebeff4;
    color: #596370;
    cursor: pointer;
  }
  .map-embed-actions button:hover { background: #d2dae5; }
  .map-embed-children {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 7px;
    padding-left: 22px;
    border-left: 2px solid #cad3e0;
  }
  .map-embed-children .map-embed {
    background: #f7f8fa;
  }
  /* Deepen the indent and dim the rail per nesting level so depth reads clearly. */
  .map-embed-children .map-embed-children {
    padding-left: 24px;
    border-left-color: #d2dae5;
  }
  .map-embed-children .map-embed-children .map-embed-children {
    border-left-color: #d2dae5;
  }
  .connection-panel button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .connection-panel button.connection-cancel {
    background: transparent;
    color: #768191;
  }

  .error-banner {
    background: #fdecea;
    color: #b00020;
    font-size: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #f5c6cb;
  }

  /* ---- draft panel ---- */
  .draft-panel {
    position: fixed;
    background: #fff;
    border: 1px solid #c5cbd4;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12);
    display: flex;
    flex-direction: column;
    min-width: 220px;
    min-height: 60px;
    z-index: 100;
    overflow: hidden;
  }

  /* Collapsed draft: a distinct amber square so it reads as "draft", not a map
     card. Drag to move, click to expand. */
  .draft-chip {
    position: fixed;
    z-index: 100;
    width: 56px;
    height: 44px;
    display: flex;
    flex-direction: row;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0;
    border: 1px solid #d6a955;
    border-radius: 9px;
    background: #f6e8c8;
    color: #7a5a16;
    box-shadow: 0 6px 18px rgba(122, 90, 22, 0.22);
    cursor: grab;
    user-select: none;
  }
  .draft-chip:active { cursor: grabbing; }
  .draft-chip:hover { background: #f3dfb4; border-color: #c79740; }
  .draft-chip-label {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .draft-chip-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #1a6fa3;
  }

  .draft-panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 12px;
    background: #f7f8fa;
    border-bottom: 1px solid #d2dae5;
    cursor: grab;
    user-select: none;
    flex-shrink: 0;
  }
  .draft-panel-header:active { cursor: grabbing; }

  .draft-panel-title {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #666;
    flex: 1;
  }

  .draft-panel-btn {
    background: #fff;
    border: 1px solid #c6d0dd;
    cursor: pointer;
    font-size: 12px;
    color: #4b5665;
    padding: 5px 9px;
    border-radius: 6px;
    line-height: 1;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .draft-panel-btn:hover { color: #212933; background: #e7ebf1; border-color: #abbace; }
  .draft-panel-btn-icon {
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .draft-chevron-down {
    width: 8px;
    height: 8px;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(45deg);
    margin-top: -3px;
  }

  .draft-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* Wrapper gives the backdrop + textarea a definite, flex-sized box. */
  .draft-editor-wrap {
    flex: 1;
    min-height: 0;
    position: relative;
    background: #fff;
  }

  /* Shared draft editing surface. */
  .draft-editor {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 10px 12px;
    font-family: inherit;
    font-size: 13px;
    line-height: 1.6;
    letter-spacing: normal;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    word-break: break-word;
    border: none;
  }

  .draft-editor {
    max-height: none;
    outline: none;
    resize: none;
    overflow-y: auto;
    background: #fff;
    color: #191a1b;
    z-index: 1;
  }
  .draft-editor:empty::before {
    content: attr(data-placeholder);
    color: #aaa;
    font-style: italic;
    pointer-events: none;
  }
  .draft-editor p {
    margin: 0 0 0.9em;
  }
  .draft-editor p:last-child {
    margin-bottom: 0;
  }
  .draft-editor ul,
  .draft-editor ol {
    margin: 0 0 0.9em 1.4em;
    padding: 0;
  }
  .draft-editor li {
    margin: 0.15em 0;
  }

  .rh { position: absolute; z-index: 10; }
  .rh-n  { top: 0; left: 8px; right: 8px; height: 6px; cursor: n-resize; }
  .rh-s  { bottom: 0; left: 8px; right: 8px; height: 6px; cursor: s-resize; }
  .rh-e  { right: 0; top: 8px; bottom: 8px; width: 6px; cursor: e-resize; }
  .rh-w  { left: 0; top: 8px; bottom: 8px; width: 6px; cursor: w-resize; }
  .rh-nw { top: 0; left: 0; width: 12px; height: 12px; cursor: nw-resize; }
  .rh-ne { top: 0; right: 0; width: 12px; height: 12px; cursor: ne-resize; }
  .rh-se { bottom: 0; right: 0; width: 12px; height: 12px; cursor: se-resize; }
  .rh-sw { bottom: 0; left: 0; width: 12px; height: 12px; cursor: sw-resize; }

  .map-shell {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .underhood-tab {
    position: absolute;
    top: 86px;
    right: 0;
    z-index: 130;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    padding: 16px 8px;
    border: 1px solid #c7d1de;
    border-right: none;
    border-radius: 0 8px 8px 0;
    background: #f7f8fa;
    color: #454e5a;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    max-height: calc(100vh - 40px);
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: -4px 6px 18px rgba(0,0,0,0.08);
    cursor: pointer;
  }
  .underhood-tab.live {
    color: #1a6fa3;
    border-color: #bcd9ee;
    background: #eef7fd;
  }

  .underhood-panel {
    position: absolute;
    top: 12px;
    right: 14px;
    z-index: 131;
    width: min(408px, calc(100% - 36px));
    max-height: calc(100vh - 24px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid #c5cfdd;
    border-radius: 12px;
    background: rgba(255, 255, 252, 0.96);
    box-shadow: 0 18px 48px rgba(35, 31, 24, 0.18);
    backdrop-filter: blur(8px);
  }

  .underhood-head {
    flex-shrink: 0;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 13px 14px 11px;
    border-bottom: 1px solid #d2dae5;
    background: linear-gradient(135deg, #f9fafc, #f5fbff);
  }
  .underhood-title {
    flex: 1;
    min-width: 0;
  }
  .underhood-title strong {
    display: block;
    font-size: 13px;
    color: #1c2026;
  }
  .underhood-title span {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    line-height: 1.35;
    color: #5a6676;
  }
  .underhood-close {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 1px solid #c5cfdd;
    border-radius: 7px;
    background: #fff;
    color: #515b6a;
    font-size: 17px;
    cursor: pointer;
  }

  .underhood-nextmove {
    flex-shrink: 0;
    padding: 8px 10px 10px;
    border-bottom: 1px solid #d2dae5;
    background: #f7f8fa;
  }
  .underhood-nextmove .underhood-section-title {
    padding: 0 2px 7px;
    background: transparent;
    border-bottom: 0;
  }
  .nextmove-list {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
  .nextmove-button {
    padding: 7px 8px;
    border: 1px solid #c5cfdd;
    border-left-width: 3px;
    border-radius: 7px;
    background: #fff;
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.2;
    color: #262d37;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.12s ease, background 0.12s ease, transform 0.08s ease;
  }
  .nextmove-button:active:not(:disabled) {
    transform: translateY(1px);
  }
  .nextmove-button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  /* Per-move accent colours (left border + hover tint). */
  .nextmove-button.mode-mirror { border-left-color: #1a6fa3; background: #f0f8fe; }
  .nextmove-button.mode-mirror:hover:not(:disabled) { border-color: #1a6fa3; background: #eef7fd; }
  .nextmove-button.mode-deepen { border-left-color: #2f8f6b; background: #f0faf5; }
  .nextmove-button.mode-deepen:hover:not(:disabled) { border-color: #2f8f6b; background: #eef8f3; }
  .nextmove-button.mode-organize { border-left-color: #c8892b; background: #fdf7ea; }
  .nextmove-button.mode-organize:hover:not(:disabled) { border-color: #c8892b; background: #fbf4e6; }
  .nextmove-button.mode-pivot { border-left-color: #7a5bb0; background: #f6f1fd; }
  .nextmove-button.mode-pivot:hover:not(:disabled) { border-color: #7a5bb0; background: #f3eefb; }

  .underhood-body {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* ---- Control Room: Now / Recap view toggle + Recap view ---- */
  .underhood-viewtabs {
    display: flex;
    gap: 6px;
    padding: 8px 10px 0;
  }
  .underhood-viewtabs button {
    flex: 1;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 5px 8px;
    border: 1px solid #c9d1dd;
    border-radius: 8px;
    background: #fff;
    color: #57616e;
    cursor: pointer;
  }
  .underhood-viewtabs button.active {
    background: #1a6fa3;
    border-color: #1a6fa3;
    color: #fff;
  }
  .recap-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .recap-stat {
    display: flex;
    flex-direction: column;
    padding: 8px 10px;
    border: 1px solid #e1e6ee;
    border-radius: 8px;
    background: #f7f8fa;
  }
  .recap-stat strong { font-size: 16px; color: #191a1b; }
  .recap-stat span { font-size: 11px; color: #8591a1; }
  .recap-authorship {
    margin-top: 8px;
    font-size: 12px;
    color: #454e5a;
  }
  .recap-timeline {
    margin: 0;
    padding-left: 18px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    font-size: 13px;
    line-height: 1.4;
    color: #191a1b;
  }
  /* Vertical trajectory rail: reads as a timeline, not a 2D mind map. */
  .recap-trail {
    list-style: none;
    margin: 0;
    padding: 0 0 0 14px;
    border-left: 2px solid #c9d1dd;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .recap-trail-node {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .recap-trail-node::before {
    content: "";
    position: absolute;
    left: -19px;
    top: 4px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #1a6fa3;
    border: 2px solid #fff;
  }
  .recap-trail-turns {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #8591a1;
  }
  .recap-trail-coach {
    font-size: 12px;
    color: #7a4a99;
  }
  .recap-trail-label {
    font-size: 13px;
    line-height: 1.4;
    color: #191a1b;
  }
  .recap-trail-subwrap {
    margin-top: 3px;
  }
  .recap-trail-subtoggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    font-size: 11px;
    color: #657181;
  }
  .recap-trail-subtoggle:hover { color: #1a6fa3; }
  .recap-trail-subideas {
    list-style: none;
    margin: 4px 0 0;
    padding: 0 0 0 12px;
    border-left: 1px dashed #c9d1dd;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .recap-trail-subideas li {
    position: relative;
    font-size: 12px;
    line-height: 1.35;
    color: #454e5a;
  }
  .recap-trail-subideas li::before {
    content: "–";
    position: absolute;
    left: -10px;
    color: #9ba8bb;
  }
  .recap-trail-mark {
    font-size: 10px;
    font-weight: 700;
    color: #1a6fa3;
  }
  .recap-built {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .recap-built li {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 13px;
    line-height: 1.4;
    color: #191a1b;
  }
  .recap-ai-badge {
    flex: 0 0 auto;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.05em;
    color: #fff;
    background: #8a4bb0;
    border-radius: 3px;
    padding: 1px 4px;
  }

  .underhood-empty {
    margin: auto;
    max-width: 260px;
    text-align: center;
    color: #626e7e;
    font-size: 13px;
    line-height: 1.45;
  }

  .underhood-section {
    border: 1px solid #d2dae5;
    border-radius: 10px;
    background: #fff;
    overflow: hidden;
  }
  .underhood-section-title {
    width: 100%;
    border: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 9px;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #5c6879;
    background: #f1f3f6;
    border-bottom: 1px solid #d2dae5;
    cursor: pointer;
    text-align: left;
  }
  .underhood-section-title:hover {
    background: #e7ebf1;
  }
  .underhood-section-title .section-title-main {
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 7px;
  }
  .underhood-section-title .section-title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .underhood-section-title .section-chevron {
    width: 14px;
    height: 14px;
    color: #748091;
    position: relative;
    flex-shrink: 0;
  }
  .underhood-section-title .section-chevron::before {
    content: "";
    position: absolute;
    left: 3px;
    top: 3px;
    width: 0;
    height: 0;
    border-style: solid;
  }
  .underhood-section-title .section-chevron.expanded::before {
    left: 1px;
    top: 5px;
    border-width: 6px 5px 0 5px;
    border-color: currentColor transparent transparent transparent;
  }
  .underhood-section-title .section-chevron.collapsed::before {
    left: 5px;
    top: 2px;
    border-width: 5px 0 5px 6px;
    border-color: transparent transparent transparent currentColor;
  }
  .underhood-section-title .section-meta {
    flex-shrink: 0;
    font-size: 10px;
    color: #7c8899;
  }
  .underhood-section.collapsed .underhood-section-title {
    border-bottom: 0;
  }

  .underhood-latest {
    padding: 8px 9px;
    display: flex;
    gap: 8px;
    align-items: flex-start;
  }
  .underhood-orb {
    width: 22px;
    height: 22px;
    border-radius: 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 800;
    color: #fff;
    background: #5c6673;
  }
  .underhood-orb.notice { background: #2d7fb0; }
  .underhood-orb.quiet { background: #798596; }
  .underhood-orb.held { background: #b37a18; }
  .underhood-latest-text strong {
    display: block;
    font-size: 12px;
    color: #21262e;
  }
  .underhood-latest-text span {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.28;
    color: #5a6678;
  }

  .event-list {
    display: grid;
    gap: 0;
    padding: 10px 10px 10px 12px;
    max-height: 244px;
    overflow-y: auto;
  }
  .event-row {
    position: relative;
    display: grid;
    grid-template-columns: 24px 1fr auto;
    gap: 8px;
    align-items: start;
    padding: 9px 9px 9px 0;
    border-radius: 9px;
    background: transparent;
    color: #4c5665;
    opacity: 0.56;
    transition: opacity 0.2s, transform 0.2s, background 0.2s, border-color 0.2s;
    border: 1px solid transparent;
  }
  .event-row:not(:last-child)::after {
    content: "";
    position: absolute;
    left: 9px;
    top: 31px;
    bottom: -5px;
    width: 2px;
    border-radius: 99px;
    background: #ccd5e1;
  }
  .event-row.revealed { opacity: 1; }
  .event-row.active {
    transform: translateX(-2px);
    background: linear-gradient(90deg, rgba(238,247,253,0.95), rgba(255,255,255,0.2));
    border-color: transparent;
  }
  .event-dot {
    position: relative;
    z-index: 1;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    border-radius: 50%;
    border: 2px solid currentColor;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 900;
  }
  .event-row.stage-noticed { color: #7d5f1c; }
  .event-row.stage-tracked { color: #286fa4; }
  .event-row.stage-checked { color: #5c6673; }
  .event-row.stage-held { color: #9a6810; }
  .event-row.stage-chosen { color: #20804a; }
  .event-row.passed .event-dot { background: #edf8f0; }
  .event-row.chosen .event-dot { background: #eef7fd; }
  .event-row.watching .event-dot { background: #fff8e8; }
  .event-row.held .event-dot { background: #fff3da; }
  .event-copy {
    min-width: 0;
  }
  .event-stage {
    display: inline-block;
    margin-bottom: 3px;
    padding: 2px 5px;
    border-radius: 99px;
    background: rgba(0,0,0,0.05);
    color: #5c6a7e;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .event-title {
    display: block;
    font-size: 12px;
    font-weight: 800;
    color: #242a32;
  }
  .event-detail {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    line-height: 1.35;
    color: #586474;
  }
  .event-evidence {
    display: inline-block;
    max-width: 100%;
    margin-top: 6px;
    padding: 3px 6px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(85, 78, 65, 0.14);
    color: #2d3744;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.3;
  }
  .event-state {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding-top: 2px;
  }
  .event-detail-toggle {
    display: block;
    width: max-content;
    margin-top: 6px;
    border: 1px solid rgba(85, 78, 65, 0.18);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.72);
    color: #404d60;
    font-size: 10px;
    font-weight: 800;
    padding: 3px 6px;
    cursor: pointer;
  }
  .event-detail-toggle:hover { background: #fff; border-color: #b5c1d3; }
  .event-technical {
    margin-top: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .event-technical span {
    border-radius: 5px;
    background: #e7ebf1;
    color: #4c5665;
    font-size: 10px;
    font-weight: 700;
    padding: 3px 5px;
  }

  .idea-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 10px;
    max-height: 208px;
    overflow-y: auto;
  }
  .idea-card {
    border: 1px solid #d2dae5;
    border-radius: 9px;
    padding: 9px;
    background: #fffdf8;
  }
  .idea-top {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: flex-start;
  }
  .idea-label {
    font-size: 13px;
    line-height: 1.35;
    color: #1c2128;
    font-weight: 650;
  }
  .idea-status {
    flex-shrink: 0;
    border-radius: 99px;
    padding: 2px 7px;
    font-size: 10px;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: #e1e6ee;
    color: #4e5b6c;
  }
  .idea-status.ready { background: #dff3e7; color: #1e7b46; }
  .idea-status.needs_your_wording { background: #fcebd1; color: #9a6810; }
  .idea-status.needs_relationship { background: #e5f0fb; color: #286fa4; }
  .idea-status.too_early { background: #e1e6ee; color: #4e5b6c; }
  .idea-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .idea-dismiss {
    border: 1px solid #c9d2df;
    background: #f7f8fa;
    color: #4e5d72;
    border-radius: 7px;
    padding: 2px 7px;
    font-size: 11px;
    font-weight: 650;
    cursor: pointer;
  }
  .idea-dismiss:hover {
    background: #fff5d5;
    border-color: #d7b762;
    color: #463b25;
  }
  .meter-group {
    margin-top: 9px;
    display: grid;
    gap: 6px;
  }
  .meter-row {
    display: grid;
    grid-template-columns: 72px 1fr;
    gap: 8px;
    align-items: center;
    font-size: 10px;
    font-weight: 700;
    color: #5a6678;
  }
  .meter-track {
    height: 7px;
    border-radius: 99px;
    background: #d2dae5;
    overflow: hidden;
  }
  .meter-fill {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #2d7fb0, #2da66b);
  }

  .waiting-card {
    margin: 10px;
    padding: 10px;
    border-radius: 9px;
    background: #fff6e5;
    color: #5f4720;
    font-size: 13px;
    line-height: 1.4;
    border: 1px solid #efd6a6;
  }

  .safety-list,
  .anchor-list {
    display: grid;
    gap: 7px;
    padding: 10px;
  }
  .safety-row {
    display: grid;
    grid-template-columns: 18px 1fr auto;
    gap: 8px;
    align-items: start;
    font-size: 12px;
    line-height: 1.35;
    color: #414a56;
  }
  .safety-mark {
    width: 16px;
    height: 16px;
    border-radius: 5px;
    background: #d2dae5;
  }
  .safety-row.ok .safety-mark { background: #98d6ad; }
  .safety-row.info .safety-mark { background: #a8d0ee; }
  .safety-row.held .safety-mark { background: #e7bf73; }
  .safety-state {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #627083;
  }

  .anchor-button {
    width: 100%;
    border: 1px solid #d2dae5;
    border-radius: 8px;
    background: #f7f8fa;
    padding: 8px;
    text-align: left;
    color: #252b33;
    cursor: pointer;
  }
  .anchor-button:hover { background: #fff5d5; border-color: #e1be65; }
  .anchor-button.parked-thread { cursor: default; }
  .anchor-button.parked-thread:hover { background: #f7f8fa; border-color: #d2dae5; }
  .anchor-kind {
    display: block;
    margin-top: 4px;
    color: #697990;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  @media (prefers-reduced-motion: reduce) {
    .event-row {
      transition: none;
      transform: none !important;
    }
  }

  @media (max-width: 900px) {
    .underhood-panel {
      left: 14px;
      right: 14px;
      top: auto;
      bottom: 14px;
      width: auto;
      max-height: min(70vh, 560px);
    }
  }
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

let msgId = 0;

function clampDraftSize(size: DraftPanelSize): DraftPanelSize {
  if (typeof window === "undefined") return size;
  const maxW = Math.max(DRAFT_MIN_VISIBLE_WIDTH, window.innerWidth - DRAFT_MARGIN * 2);
  const maxH = Math.max(DRAFT_MIN_VISIBLE_HEIGHT, window.innerHeight - DRAFT_MARGIN * 2);
  return {
    w: Math.min(Math.max(DRAFT_MIN_VISIBLE_WIDTH, size.w), maxW),
    h: Math.min(Math.max(DRAFT_MIN_VISIBLE_HEIGHT, size.h), maxH),
  };
}

function clampDraftPosition(pos: DraftPanelPos, size: DraftPanelSize): DraftPanelPos {
  if (typeof window === "undefined") return pos;
  const visibleW = Math.min(size.w, window.innerWidth - DRAFT_MARGIN * 2);
  const maxX = Math.max(DRAFT_MARGIN, window.innerWidth - visibleW - DRAFT_MARGIN);
  const maxY = Math.max(DRAFT_MARGIN, window.innerHeight - DRAFT_HEADER_HEIGHT - DRAFT_MARGIN);
  return {
    x: Math.min(Math.max(DRAFT_MARGIN, pos.x), maxX),
    y: Math.min(Math.max(DRAFT_MARGIN, pos.y), maxY),
  };
}

// Clamp so the *entire* box (w x h) stays within the viewport. Used for the
// collapsed chip (so it can reach the right/bottom edges) and for choosing an
// expand position that keeps the whole panel on-screen.
function clampBoxPosition(pos: DraftPanelPos, w: number, h: number): DraftPanelPos {
  if (typeof window === "undefined") return pos;
  const maxX = Math.max(DRAFT_MARGIN, window.innerWidth - w - DRAFT_MARGIN);
  const maxY = Math.max(DRAFT_MARGIN, window.innerHeight - h - DRAFT_MARGIN);
  return {
    x: Math.min(Math.max(DRAFT_MARGIN, pos.x), maxX),
    y: Math.min(Math.max(DRAFT_MARGIN, pos.y), maxY),
  };
}

function defaultDraftPosition(size: DraftPanelSize): DraftPanelPos {
  if (typeof window === "undefined") return { x: 0, y: 0 };
  return clampDraftPosition(
    { x: window.innerWidth - size.w - 20, y: 80 },
    size,
  );
}

function loadPersistedSession(): PersistedSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    return parsed.version >= 1 && parsed.version <= 6 ? parsed : null;
  } catch {
    return null;
  }
}

function buildConversationHistory(msgs: ChatMsg[]): ConversationMessage[] {
  return msgs
    .filter((msg) => msg.role === "user" || msg.role === "assistant")
    .map((msg) => ({
      role: msg.role,
      content: msg.text,
    }));
}

function normalizeDraftPlainTextPaste(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");
  const lines = normalized.split("\n");
  const hasBlankLine = lines.some((line) => line.trim() === "");
  const nonEmptyLines = lines.filter((line) => line.trim() !== "");
  if (hasBlankLine || nonEmptyLines.length < 2) return normalized;
  return lines.join("\n\n");
}

function escapeDraftHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function plainTextToDraftHtml(text: string): string {
  if (!text) return "";
  return normalizeDraftPlainTextPaste(text)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trimEnd())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeDraftHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function sanitizeDraftHtml(html: string): string {
  if (!html.trim() || typeof DOMParser === "undefined") return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const renderChildren = (node: Node): string =>
    Array.from(node.childNodes).map(renderNode).join("");

  const hasBlockChild = (element: HTMLElement): boolean =>
    Array.from(element.children).some((child) =>
      child instanceof HTMLElement &&
      (/^(P|DIV|UL|OL|LI|H[1-6]|BLOCKQUOTE|SECTION|PRE)$/).test(child.tagName),
    );

  const isBoldElement = (element: HTMLElement): boolean => {
    const weight = element.style.fontWeight;
    if (/^(normal|400)$/i.test(weight)) return false;
    return element.tagName === "B" || element.tagName === "STRONG" || /^(bold|[5-9]00)$/i.test(weight);
  };

  const isItalicElement = (element: HTMLElement): boolean =>
    element.tagName === "I" || element.tagName === "EM" || /italic/i.test(element.style.fontStyle);

  const isUnderlineElement = (element: HTMLElement): boolean =>
    element.tagName === "U" || /underline/i.test(element.style.textDecorationLine || element.style.textDecoration);

  const wrapInlineMarks = (element: HTMLElement, htmlText: string): string => {
    if (!htmlText || hasBlockChild(element)) return htmlText;
    let out = htmlText;
    if (isUnderlineElement(element)) out = `<u>${out}</u>`;
    if (isItalicElement(element)) out = `<em>${out}</em>`;
    if (isBoldElement(element)) out = `<strong>${out}</strong>`;
    return out;
  };

  const renderNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return escapeDraftHtml((node.textContent ?? "").replace(/\u00a0/g, " "));
    if (!(node instanceof HTMLElement)) return renderChildren(node);
    const tag = node.tagName;
    if (tag === "BR") return "<br>";
    if (tag === "UL" || tag === "OL") {
      const items: string[] = [];
      for (const child of Array.from(node.childNodes)) {
        if (!(child instanceof HTMLElement)) continue;
        if (child.tagName === "LI") {
          items.push(`<li>${renderChildren(child).trim() || "<br>"}</li>`);
        } else if (child.tagName === "UL" || child.tagName === "OL") {
          const nested = renderNode(child);
          if (nested && items.length > 0) {
            items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `${nested}</li>`);
          } else if (nested) {
            items.push(`<li>${nested}</li>`);
          }
        }
      }
      return items.length > 0 ? `<${tag.toLowerCase()}>${items.join("")}</${tag.toLowerCase()}>` : "";
    }
    if (tag === "LI") return `<li>${renderChildren(node).trim() || "<br>"}</li>`;
    if (tag === "P" || tag === "DIV" || /^H[1-6]$/.test(tag) || tag === "BLOCKQUOTE" || tag === "SECTION") {
      const body = renderChildren(node).trim();
      return body ? `<p>${body}</p>` : "";
    }
    if (tag === "PRE") {
      const body = escapeDraftHtml(node.textContent ?? "").replace(/\n/g, "<br>");
      return body ? `<p>${body}</p>` : "";
    }
    return wrapInlineMarks(node, renderChildren(node));
  };

  const sanitized = renderChildren(doc.body).replace(/(<br>\s*){3,}/g, "<br><br>").trim();
  return sanitized;
}

function insertDraftHtmlAtSelection(root: HTMLElement, html: string): void {
  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !root.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    root.append(fragment);
    return;
  }
  const range = selection.getRangeAt(0);
  range.deleteContents();
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    const nextRange = document.createRange();
    nextRange.setStartAfter(lastNode);
    nextRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(nextRange);
  }
}

export function normalizeDraftPasteHtml(plainText: string, html = ""): string {
  const sanitized = sanitizeDraftHtml(html);
  if (sanitized.trim()) return sanitized;
  return plainTextToDraftHtml(plainText);
}

export function draftHtmlToPlainText(html: string): string {
  if (!html.trim() || typeof DOMParser === "undefined") return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const listStack: string[] = [];

  const renderChildren = (node: Node): string =>
    Array.from(node.childNodes).map(renderNode).join("");

  const renderNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u00a0/g, " ");
    if (!(node instanceof HTMLElement)) return renderChildren(node);
    const tag = node.tagName;
    if (tag === "BR") return "\n";
    if (tag === "P" || tag === "DIV" || /^H[1-6]$/.test(tag) || tag === "BLOCKQUOTE" || tag === "SECTION") {
      const text = renderChildren(node).trimEnd();
      return text ? `${text}\n\n` : "";
    }
    if (tag === "UL" || tag === "OL") {
      listStack.push(tag);
      const text = renderChildren(node);
      listStack.pop();
      return text ? `${text}\n` : "";
    }
    if (tag === "LI") {
      const marker = listStack[listStack.length - 1] === "OL" ? "1. " : "- ";
      const text = renderChildren(node).trim();
      return text ? `${marker}${text}\n` : "";
    }
    return renderChildren(node);
  };

  return renderChildren(doc.body)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

function selectTextInElement(root: HTMLElement, searchText: string): boolean {
  const needle = searchText.trim();
  if (!needle) return false;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Array<{ node: Text; start: number; end: number }> = [];
  let fullText = "";
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const node = current as Text;
    const start = fullText.length;
    fullText += node.data;
    textNodes.push({ node, start, end: fullText.length });
  }
  const start = fullText.indexOf(needle);
  if (start < 0) return false;
  const end = start + needle.length;
  const startNode = textNodes.find((entry) => start >= entry.start && start <= entry.end);
  const endNode = textNodes.find((entry) => end >= entry.start && end <= entry.end);
  if (!startNode || !endNode) return false;
  const range = document.createRange();
  range.setStart(startNode.node, Math.max(0, start - startNode.start));
  range.setEnd(endNode.node, Math.max(0, end - endNode.start));
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  const rect = range.getBoundingClientRect();
  const editorRect = root.getBoundingClientRect();
  root.scrollTop += rect.top - editorRect.top - 24;
  return true;
}

function statusLabel(status: TrackedIdea["status"]): string {
  switch (status) {
    case "ready":
      return "ready";
    case "needs_your_wording":
      return "needs words";
    case "needs_relationship":
      return "needs relation";
    case "too_early":
      return "too early";
  }
}

function targetLabel(target: TrackedIdea["target"]): string {
  return target === "idea" ? "idea" : target === "hierarchy" ? "nesting" : "connection";
}

function eventStageMark(stage: NonNullable<UnderhoodEvent["stage"]>): string {
  return {
    noticed: "1",
    tracked: "2",
    checked: "3",
    held: "!",
    chosen: ">",
  }[stage];
}

function eventStage(event: UnderhoodEvent): NonNullable<UnderhoodEvent["stage"]> {
  const stage = event.stage as UnderhoodEvent["stage"] | undefined;
  if (stage) return stage;
  if (event.state === "held") return "held";
  if (event.state === "chosen") return "chosen";
  if (event.state === "passed") return "checked";
  return "noticed";
}

function underhoodTabLabel(snapshot: UnderstandingSnapshot | null): string {
  if (!snapshot) return "Control Room";
  return snapshot.activeEvents[0]?.title ?? snapshot.latest.title ?? "Control Room";
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="meter-row">
      <span>{label}</span>
      <span className="meter-track" aria-label={`${label} ${Math.round(value * 100)} percent`}>
        <span className="meter-fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 11a7 7 0 0 0 14 0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 18v3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 21h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UnderhoodIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 5h14v14H5z" fill="none" stroke="currentColor" strokeLinejoin="round" />
      <path d="M8 9h8M8 12h5M8 15h7" fill="none" stroke="currentColor" strokeLinecap="round" />
      <path d="M3 9h2M3 15h2M19 9h2M19 15h2" fill="none" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The user-facing "next move" controls. Deliberately labelled in plain user
 * verbs - never stance names, candidate gists, or model prose - so the user can
 * steer (and unstick) the coach without being anchored on AI scaffolding. This
 * emits only a coach-steering request; it never authors a map write.
 */
const NEXT_MOVE_OPTIONS: { mode: UserRequestedMode; label: string; hint: string }[] = [
  { mode: "mirror", label: "Reflect back", hint: "Sum up what I've said so far" },
  { mode: "deepen", label: "Go deeper", hint: "Dig into the idea on the table" },
  { mode: "organize", label: "Connect ideas", hint: "Ask how my thoughts relate" },
  { mode: "pivot", label: "Ask differently", hint: "Same subject, a fresh angle" },
];

type UnderhoodSectionId =
  | "nextMove"
  | "latest"
  | "mattered"
  | "ideas"
  | "waiting"
  | "safety"
  | "openThreads"
  | "draftAnchors";

const STATIC_SAFETY_LABEL = "I won't change your map unless you ask me to.";

function isStaticSafetyCheck(check: SafetyCheck): boolean {
  return check.state === "ok" && check.label === STATIC_SAFETY_LABEL;
}

function UnderhoodSection({
  title,
  meta,
  collapsed,
  onToggle,
  className = "",
  children,
}: {
  title: string;
  meta?: string | number;
  collapsed: boolean;
  onToggle: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`underhood-section ${collapsed ? "collapsed" : ""} ${className}`.trim()}>
      <button
        type="button"
        className="underhood-section-title"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="section-title-main">
          <span className={`section-chevron ${collapsed ? "collapsed" : "expanded"}`} aria-hidden="true" />
          <span className="section-title-text">{title}</span>
        </span>
        {meta !== undefined && <span className="section-meta">{meta}</span>}
      </button>
      {!collapsed && children}
    </section>
  );
}

export function UnderTheHoodPanel({
  snapshot,
  recap,
  onSegmentThinking,
  onDraftAnchor,
  onRequestMode,
  onDismissIdea,
  busy = false,
  open: controlledOpen,
  onOpenChange,
}: {
  snapshot: UnderstandingSnapshot | null;
  recap?: RecapData;
  onSegmentThinking?: (beats: RecapData["turnBeats"]) => Promise<ThinkingSegment[]>;
  onDraftAnchor: (anchor: string) => void;
  onRequestMode?: (mode: UserRequestedMode) => void;
  onDismissIdea?: (ideaId: string) => void;
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [view, setView] = useState<"now" | "recap">("now");
  const [segments, setSegments] = useState<ThinkingSegment[]>([]);
  const [segmenting, setSegmenting] = useState(false);
  const segmentedCountRef = useRef(-1);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOpen === undefined) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);
    },
    [controlledOpen, onOpenChange],
  );
  const [activeEvent, setActiveEvent] = useState(0);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [sectionCollapsed, setSectionCollapsed] = useState<Partial<Record<UnderhoodSectionId, boolean>>>({});
  const events = useMemo(
    () => (snapshot?.activeEvents ?? []).filter((event) => event.kind !== "question_chosen"),
    [snapshot?.activeEvents],
  );
  const safetyChecks = snapshot?.safetyChecks ?? [];
  const showSafetyChecks =
    safetyChecks.length > 0 && !safetyChecks.every((check) => isStaticSafetyCheck(check));

  function sectionIsCollapsed(id: UnderhoodSectionId, defaultCollapsed = false): boolean {
    return sectionCollapsed[id] ?? defaultCollapsed;
  }

  function toggleSection(id: UnderhoodSectionId, defaultCollapsed = false) {
    setSectionCollapsed((current) => ({
      ...current,
      [id]: !(current[id] ?? defaultCollapsed),
    }));
  }

  useEffect(() => {
    setExpandedEvents(new Set());
    if (!snapshot || !open) {
      setActiveEvent(0);
      return;
    }
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setActiveEvent(events.length);
      return;
    }
    setActiveEvent(0);
    const timers = events.map((_, index) =>
      window.setTimeout(() => setActiveEvent(index + 1), 220 + index * 260),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [events, open, snapshot]);

  // Segment the trajectory on demand (only when the Recap view is open) and cache
  // it by turn count, so we don't re-call the model every time the panel toggles.
  useEffect(() => {
    if (view !== "recap" || !open || !recap || !onSegmentThinking) return;
    const count = recap.turnBeats.length;
    if (count === 0) { setSegments([]); segmentedCountRef.current = 0; return; }
    if (count === segmentedCountRef.current) return;
    let cancelled = false;
    setSegmenting(true);
    onSegmentThinking(recap.turnBeats)
      .then((result) => { if (!cancelled) { setSegments(result); segmentedCountRef.current = count; } })
      .catch(() => { /* keep whatever was cached */ })
      .finally(() => { if (!cancelled) setSegmenting(false); });
    return () => { cancelled = true; };
  }, [view, open, recap, onSegmentThinking]);

  function toggleEventDetail(id: string) {
    setExpandedEvents((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`underhood-tab ${snapshot ? "live" : ""}`}
        onClick={() => setOpen(true)}
        aria-label="Open Control Room panel"
      >
        {underhoodTabLabel(snapshot)}
      </button>
    );
  }

  return (
    <aside className="underhood-panel" aria-label="Control Room">
      <div className="underhood-head">
        <div className="underhood-title">
          <strong>Control Room</strong>
          <span>{snapshot?.banner ?? "This will show what the coach is considering as we talk."}</span>
        </div>
        <button
          type="button"
          className="underhood-close"
          onClick={() => setOpen(false)}
          aria-label="Close Control Room panel"
        >
          x
        </button>
      </div>

      {recap && (
        <div className="underhood-viewtabs">
          <button type="button" className={view === "now" ? "active" : ""} onClick={() => setView("now")}>Now</button>
          <button type="button" className={view === "recap" ? "active" : ""} onClick={() => setView("recap")}>Recap</button>
        </div>
      )}

      {recap && view === "recap" ? (
        <div className="underhood-body recap-body">
          <UnderhoodSection title="At a glance" collapsed={false} onToggle={() => {}}>
            <div className="recap-stats">
              <div className="recap-stat"><strong>{recap.turnCount}</strong><span>your turns</span></div>
              <div className="recap-stat">
                <strong>{recap.levelSwitched ? `${recap.dominantLevelLabel} → ${recap.currentLevelLabel}` : recap.currentLevelLabel}</strong>
                <span>{recap.levelSwitched ? "assistance (mostly → now)" : "assistance"}</span>
              </div>
              <div className="recap-stat"><strong>{recap.cardsTotal}</strong><span>cards</span></div>
              <div className="recap-stat"><strong>{recap.connectionCount}</strong><span>connections</span></div>
            </div>
            <div
              className="recap-authorship"
              title="Counts cards committed to the map, not chat turns. Cards from AI suggestions only occur at L2 (Suggestive)."
            >
              Cards on map: <strong>{recap.yourCards}</strong> yours {"·"} <strong>{recap.aiCards}</strong> from AI suggestions
            </div>
            {recap.suggestionsOffered > 0 && (
              <div className="recap-authorship">
                AI ideas: <strong>{recap.aiCards}</strong> taken {"/"} <strong>{recap.suggestionsOffered}</strong> offered
                {" "}({Math.round((recap.aiCards / recap.suggestionsOffered) * 100)}%)
              </div>
            )}
          </UnderhoodSection>

          <UnderhoodSection
            title="Your thinking, in order"
            meta={segments.length > 0 ? segments.length : recap.timeline.length}
            collapsed={false}
            onToggle={() => {}}
          >
            {recap.timeline.length === 0 ? (
              <div className="waiting-card">Nothing captured yet — say what's on your mind.</div>
            ) : segmenting && segments.length === 0 ? (
              <div className="waiting-card">Reading your thinking…</div>
            ) : segments.length > 0 ? (
              <ol className="recap-trail">
                {segments.map((segment, index) => (
                  <li key={index} className="recap-trail-node">
                    <span className="recap-trail-turns">
                      {segment.start === segment.end ? `turn ${segment.start}` : `turns ${segment.start}–${segment.end}`}
                    </span>
                    {coachMoveLabel(segment.coachKind) && (
                      <span className="recap-trail-coach">coach {coachMoveLabel(segment.coachKind)}</span>
                    )}
                    <span className="recap-trail-label">you: {segment.label}</span>
                    <RecapSubIdeas subIdeas={segment.subIdeas} />
                    {segment.onMap && (
                      <span className="recap-trail-mark">{"→"} on map{segment.aiOrigin ? " · AI" : ""}</span>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <ol className="recap-timeline">
                {recap.timeline.map((entry, index) => (
                  <li key={index}>{entry}</li>
                ))}
              </ol>
            )}
          </UnderhoodSection>

          <UnderhoodSection title="What you built" meta={recap.cardsTotal} collapsed={false} onToggle={() => {}}>
            {recap.built.length === 0 ? (
              <div className="waiting-card">No cards on the map yet.</div>
            ) : (
              <ul className="recap-built">
                {recap.built.map((card, index) => (
                  <li key={index} className={card.ai ? "ai" : ""}>
                    {card.ai && <span className="recap-ai-badge">AI</span>}
                    <span>{card.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </UnderhoodSection>
        </div>
      ) : (
        <>
      {onRequestMode && (
        <UnderhoodSection
          title="Steer the coach"
          collapsed={sectionIsCollapsed("nextMove")}
          onToggle={() => toggleSection("nextMove")}
          className="underhood-nextmove"
        >
          <div className="nextmove-list">
            {NEXT_MOVE_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                className={`nextmove-button mode-${option.mode}`}
                onClick={() => onRequestMode(option.mode)}
                disabled={busy}
                title={option.hint}
              >
                {option.label}
              </button>
            ))}
          </div>
        </UnderhoodSection>
      )}

      {!snapshot ? (
        <div className="underhood-empty">
          Start a turn and I'll show the read-only checks, tracked ideas, and safety gates here.
        </div>
      ) : (
        <div className="underhood-body">
          <UnderhoodSection
            title="Latest move"
            collapsed={sectionIsCollapsed("latest")}
            onToggle={() => toggleSection("latest")}
          >
            <div className="underhood-latest">
              <span className={`underhood-orb ${snapshot.latest.level}`} aria-hidden="true">
                {snapshot.latest.level === "held" ? "!" : snapshot.latest.level === "notice" ? "*" : "..."}
              </span>
              <div className="underhood-latest-text">
                <strong>{snapshot.latest.title}</strong>
                <span>{snapshot.latest.explanation}</span>
              </div>
            </div>
          </UnderhoodSection>

          {events.length > 0 && (
          <UnderhoodSection
            title="What mattered this turn"
            meta={`${Math.min(activeEvent, events.length)}/${events.length}`}
            collapsed={sectionIsCollapsed("mattered")}
            onToggle={() => toggleSection("mattered")}
          >
            <div className="event-list">
              {events.map((event, index) => {
                const revealed = index < activeEvent;
                const active = index === activeEvent;
                const expanded = expandedEvents.has(event.id);
                const hasDetail = Boolean(event.technicalDetail?.length);
                const stage = eventStage(event);
                return (
                  <div
                    key={event.id}
                    className={`event-row ${event.state} stage-${stage} ${revealed ? "revealed" : ""} ${active ? "active" : ""}`}
                  >
                    <span className="event-dot">{revealed ? eventStageMark(stage) : ""}</span>
                    <span className="event-copy">
                      <span className="event-stage">{stage}</span>
                      <span className="event-title">{event.title}</span>
                      <span className="event-detail">{event.detail}</span>
                      {event.evidence && <span className="event-evidence">{event.evidence}</span>}
                      {hasDetail && revealed && (
                        <>
                          <button
                            type="button"
                            className="event-detail-toggle"
                            onClick={() => toggleEventDetail(event.id)}
                            aria-expanded={expanded}
                          >
                            {expanded ? "Hide detail" : "Show detail"}
                          </button>
                          {expanded && (
                            <div className="event-technical">
                              {event.technicalDetail?.map((detail) => (
                                <span key={detail}>{detail}</span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </span>
                    <span className="event-state">{revealed ? event.stateLabel : "checking"}</span>
                  </div>
                );
              })}
            </div>
          </UnderhoodSection>
          )}

          <UnderhoodSection
            title="Ideas I'm tracking"
            meta={snapshot.trackedIdeas.length}
            collapsed={sectionIsCollapsed("ideas", snapshot.trackedIdeas.length > 3)}
            onToggle={() => toggleSection("ideas", snapshot.trackedIdeas.length > 3)}
          >
            {snapshot.trackedIdeas.length === 0 ? (
              <div className="waiting-card">No tracked idea is settled enough to display yet.</div>
            ) : (
              <div className="idea-list">
                {snapshot.trackedIdeas.map((idea) => (
                  <div key={idea.id} className="idea-card">
                    <div className="idea-top">
                      <div>
                        <div className="idea-label">{idea.label}</div>
                        <span className="anchor-kind">{targetLabel(idea.target)}</span>
                      </div>
                      <div className="idea-actions">
                        <span className={`idea-status ${idea.status}`}>{statusLabel(idea.status)}</span>
                        {onDismissIdea && (
                          <button
                            type="button"
                            className="idea-dismiss"
                            onClick={() => onDismissIdea(idea.id)}
                            disabled={busy}
                          >
                            Dismiss
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="meter-group">
                      <Meter label="Grounded" value={idea.meters.grounded} />
                      <Meter label="Specific" value={idea.meters.specific} />
                      {idea.showRelated && <Meter label="Related" value={idea.meters.related} />}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </UnderhoodSection>

          {snapshot.waitingFor && (
            <UnderhoodSection
              title="Waiting for"
              collapsed={sectionIsCollapsed("waiting")}
              onToggle={() => toggleSection("waiting")}
            >
              <div className="waiting-card">{snapshot.waitingFor}</div>
            </UnderhoodSection>
          )}

          {snapshot.openThreads.length > 0 && (
            <UnderhoodSection
              title="Parked earlier phrases"
              meta={snapshot.openThreads.length}
              collapsed={sectionIsCollapsed("openThreads", true)}
              onToggle={() => toggleSection("openThreads", true)}
            >
              <div className="anchor-list">
                {snapshot.openThreads.map((thread) => (
                  <div key={thread.id} className="anchor-button parked-thread">
                    {thread.label}
                    <span className="anchor-kind">{thread.status}</span>
                  </div>
                ))}
              </div>
            </UnderhoodSection>
          )}

          {showSafetyChecks && (
          <UnderhoodSection
            title="Safety checks"
            meta={safetyChecks.length}
            collapsed={sectionIsCollapsed("safety")}
            onToggle={() => toggleSection("safety")}
          >
            <div className="safety-list">
              {safetyChecks.map((check: SafetyCheck) => (
                <div
                  key={check.id}
                  className={`safety-row ${check.state}`}
                  aria-label={`${check.state}: ${check.label}`}
                >
                  <span className="safety-mark" />
                  <span>{check.label}</span>
                  <span className="safety-state">{check.state}</span>
                </div>
              ))}
            </div>
          </UnderhoodSection>
          )}

          {snapshot.draftAnchors.length > 0 && (
            <UnderhoodSection
              title="Draft anchors"
              meta={snapshot.draftAnchors.length}
              collapsed={sectionIsCollapsed("draftAnchors", true)}
              onToggle={() => toggleSection("draftAnchors", true)}
            >
              <div className="anchor-list">
                {snapshot.draftAnchors.map((anchor) => (
                  <button
                    key={anchor.anchor}
                    type="button"
                    className="anchor-button"
                    onClick={() => onDraftAnchor(anchor.anchor)}
                  >
                    {anchor.label}
                    <span className="anchor-kind">{anchor.kind.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            </UnderhoodSection>
          )}
        </div>
      )}
        </>
      )}
    </aside>
  );
}

export default function App() {
  const persistedSession = useMemo(() => loadPersistedSession(), []);
  const initialContract = contractForLevel(persistedSession?.assistanceLevel ?? 0);
  const initialSessionId = persistedSession?.sessionId ?? newSessionId();

  const initialState = useMemo(() => {
    const state = createConversationState();
    if (!persistedSession) return state;
    state.bank.replaceAll(persistedSession.bank);
    state.candidates.replaceAll(persistedSession.candidates);
    state.turnsSinceLastReflection = persistedSession.conversation?.turnsSinceLastReflection ?? persistedSession.controller?.turnsSinceLastMirror ?? 0;
    state.lastAssistantText = persistedSession.conversation?.lastAssistantText ?? persistedSession.controller?.lastAiText ?? "";
    state.draft = persistedSession.conversation?.draft ?? persistedSession.controller?.draft ?? persistedSession.draftText;
    state.dismissedCandidateIds = persistedSession.conversation?.dismissedCandidateIds ?? persistedSession.controller?.dismissedCandidateIds ?? [];
    state.openThreads = persistedSession.conversation?.openThreads ?? persistedSession.controller?.openThreads ?? [];
    return state;
  }, [persistedSession]);

  const initialMapStore = useMemo(() => {
    const store = new ThoughtUnitStore();
    if (persistedSession) {
      executeCanvasAction({ kind: "restore_snapshot", snapshot: persistedSession.map }, { store, bank: initialState.bank });
      for (const unit of store.getAll()) {
        if (!unit.source.origin) store.update(unit.id, { source: { ...unit.source, origin: unit.source.reflectionId ? "legacy_confirmed" : "user_canvas" } });
      }
    }
    return store;
  }, [initialState.bank, persistedSession]);

  const migratedMirrorProposals = useMemo<Proposal[]>(() => migrateLegacyMirrors(persistedSession?.pendingMirrors ?? [], persistedSession?.mapRevision ?? 0), [persistedSession]);
  const initialMsgs = useMemo(() => (persistedSession?.msgs ?? []).map((message) => message.mirrorId && !message.proposalId ? { ...message, proposalId: message.mirrorId, mirrorId: undefined } : message), [persistedSession]);
  const initialProposals = useMemo(
    () => createProposalStore(migrateStoredProposals([...(persistedSession?.proposals ?? []), ...migratedMirrorProposals], initialState.bank, initialMapStore)),
    [initialMapStore, initialState.bank, migratedMirrorProposals, persistedSession],
  );
  const initialConfirmed = persistedSession?.confirmed ?? [];
  const initialCoachDebug = persistedSession?.lastCoachDebug ?? null;
  // Under-the-Hood is a transparency surface, so do not trust a snapshot read
  // back from localStorage as live cognition. Show a fresh snapshot only after a
  // controller turn rebuilds it from code-owned state in this session.
  const initialUnderstandingSnapshot = null;
  const initialMapRevision = persistedSession?.mapRevision ?? 0;
  const initialQuestionBias = snapQuestionBias(persistedSession?.questionBias ?? 35);
  const initialRequireConnectionLabel = persistedSession?.requireConnectionLabel ?? true;
  const initialDraftText = persistedSession?.draftText ?? "";
  const initialDraftHtml = persistedSession?.draftHtml ?? plainTextToDraftHtml(initialDraftText);
  const initialDraftCollapsed = persistedSession?.draftCollapsed ?? false;
  const initialDraftDocked = persistedSession?.draftDocked ?? false;
  const initialDraftSize = persistedSession
    ? clampDraftSize(persistedSession.draftSize)
    : { w: 440, h: 340 };
  const initialDraftPos = persistedSession
    ? clampDraftPosition(persistedSession.draftPos, initialDraftSize)
    : { x: 0, y: 0 };
  const initialStickyDraftFocus = persistedSession?.stickyDraftFocus;

  const stateRef = useRef<ConversationState>(initialState);
  const configRef = useRef<MindmapConfig>(withQuestionIntentBias(defaultConfig, initialQuestionBias));
  const mapStoreRef = useRef<ThoughtUnitStore>(initialMapStore);
  const undoStackRef = useRef<MapUndoSnapshot[]>([]);

  const [msgs, setMsgs] = useState<ChatMsg[]>(initialMsgs);
  const [proposals, setProposals] = useState(initialProposals);
  const [confirmed, setConfirmed] = useState<ConfirmedReflection[]>(initialConfirmed);
  const [lastCoachDebug, setLastCoachDebug] = useState<CoachDebugInfo | null>(initialCoachDebug);
  const [understandingSnapshot, setUnderstandingSnapshot] = useState<UnderstandingSnapshot | null>(initialUnderstandingSnapshot);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEvent[]>(persistedSession?.diagnostics ?? []);
  const [mapRevision, setMapRevision] = useState(initialMapRevision);
  const [mapMountKey, setMapMountKey] = useState(0);
  const [questionBias, setQuestionBias] = useState(initialQuestionBias);
  const [assistanceLevel, setAssistanceLevel] = useState<AssistanceLevel>(initialContract.level);
  // Comparison preview: when on, a turn is answered once per contract level in a
  // single call and shown read-only, side by side. Nothing is committed.
  const [compareMode, setCompareMode] = useState(false);
  const [ledgerAvailable, setLedgerAvailable] = useState(true);
  const [requireConnectionLabel, setRequireConnectionLabel] = useState(initialRequireConnectionLabel);
  const [canUndoMap, setCanUndoMap] = useState(false);
  const [commandAck, setCommandAck] = useState<MapCommandAcknowledgement | null>(null);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [composerScrollable, setComposerScrollable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [underhoodOpen, setUnderhoodOpen] = useState(false);
  const [contextSelectedCardIds, setContextSelectedCardIds] = useState<Set<string>>(new Set());
  const [draftSelectionFocus, setDraftSelectionFocus] = useState<DraftSelectionFocus | undefined>(undefined);
  const [stickyDraftFocus, setStickyDraftFocus] = useState<DraftSelectionFocus | undefined>(initialStickyDraftFocus);
  const ledgerRef = useRef(new EventLedger(initialSessionId));
  // Per-comparison working state (with this turn's user words already ingested) +
  // the parsed per-level responses, so "Continue with this" can replay the exact
  // previewed response on the same bank (grounding ids match) without a new call.
  const comparePreviewRef = useRef(new Map<number, { state: ReturnType<typeof cloneConversationState>; results: LevelComparisonResult[] }>());
  const contract = contractForLevel(assistanceLevel);

  const recordEvent = useCallback(async (kind: LedgerEventKind, detail?: unknown, extra?: { origin?: import("./assistance-contract").ContributionOrigin; responseKind?: string; outcome?: string; code?: string; contract?: import("./assistance-contract").AssistanceContractSnapshot; providerTransport?: "chat_json" | "responses_tools"; toolName?: "propose_reflection_v1" | "propose_map_action_v1"; repairCount?: number }) => {
    const event = await ledgerRef.current.record(kind, detail, { contract: extra?.contract ?? snapshotContract(contract), origin: extra?.origin });
    setLedgerAvailable(ledgerRef.current.isAvailable);
    void mirrorSanitizedEvent(event, { responseKind: extra?.responseKind, outcome: extra?.outcome, code: extra?.code, providerTransport: extra?.providerTransport, toolName: extra?.toolName, repairCount: extra?.repairCount });
  }, [contract]);

  useEffect(() => {
    void recordEvent((persistedSession?.version ?? 0) >= 5 ? "contract_selected" : "contract_initialized", { reason: persistedSession ? "migration" : "new_session" });
  // The first mount records initial contract only. Level changes have their own event below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runtimeConfig = useMemo(
    () => withQuestionIntentBias(defaultConfig, questionBias),
    [questionBias],
  );

  useEffect(() => {
    configRef.current = runtimeConfig;
  }, [runtimeConfig]);

  const captureMapUndo = useCallback(() => {
    undoStackRef.current.push({
      map: mapStoreRef.current.snapshot(),
      bank: stateRef.current.bank.getAll(),
    });
    if (undoStackRef.current.length > 50) {
      undoStackRef.current.shift();
    }
    setCanUndoMap(true);
  }, []);

  const markMapChanged = useCallback(() => {
    setMapRevision((v) => v + 1);
  }, []);

  const markUserMapChanged = useCallback(() => {
    setCommandAck(null);
    markMapChanged();
  }, [markMapChanged]);

  const undoMapChange = useCallback(() => {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    executeCanvasAction({ kind: "restore_snapshot", snapshot: previous.map }, { store: mapStoreRef.current, bank: stateRef.current.bank });
    stateRef.current.bank.replaceAll(previous.bank);
    setCanUndoMap(undoStackRef.current.length > 0);
    setCommandAck(null);
    markMapChanged();
  }, [markMapChanged]);

  const updateActionProposal = useCallback((proposalId: string, action: ProposedAction) => {
    setProposals((current) => {
      const proposal = current.get(proposalId);
      if (!proposal || proposal.detail.kind !== "map_action") return current;
      return updateProposal(current, proposalId, {
        state: "edited",
        detail: { ...proposal.detail, action, executable: undefined, completion: undefined },
      });
    });
  }, []);

  const groundEditedAction = useCallback((action: ProposedAction): ProposedAction => {
    const sourceFor = (text: string, ids: string[] | undefined): string[] => {
      if (ids?.some((id) => stateRef.current.bank.get(id)?.text.includes(text))) return ids;
      const declaration = stateRef.current.bank.add(text, "declaration");
      stateRef.current.bank.markCommandOnly([declaration.id]);
      return [...(ids ?? []), declaration.id];
    };
    if (action.kind === "create_card") {
      return { ...action, sourceUtteranceIds: sourceFor(action.text, action.sourceUtteranceIds) };
    }
    if (action.kind === "edit_card") {
      return { ...action, sourceUtteranceIds: sourceFor(action.text, action.sourceUtteranceIds) };
    }
    if (action.kind === "connect_cards" && action.labelText?.trim()) {
      return { ...action, labelSourceUtteranceIds: sourceFor(action.labelText, action.labelSourceUtteranceIds) };
    }
    return action;
  }, []);

  const decideActionProposal = useCallback((proposalId: string, decision: "confirmed" | "declined") => {
    const proposal = proposals.get(proposalId);
    if (!proposal || proposal.detail.kind !== "map_action") return;
    if (decision === "declined") {
      setProposals((current) => resolveProposal(current, proposalId, "declined"));
      void recordEvent("proposal_resolved", { proposalId, decision }, { origin: proposal.origin, outcome: "declined" });
      return;
    }
    let action = proposal.detail.action;
    let capturedUndo = false;
    let checked = inspectAction(action, {
      actor: "ai_proposal",
      store: mapStoreRef.current,
      bank: stateRef.current.bank,
      requireConnectionLabel,
      allowAiSuggestedStructure: proposal.contract?.allowsAiSuggestedStructure ?? false,
      allowGroundedOptions: proposal.contract?.allowedResponseKinds.includes("options") ?? false,
      verifiedPairingProof: proposal.detail.pairingProof ?? (proposal.detail.completion?.kind === "relationship_label" ? proposal.detail.completion.pairingProof : undefined),
    });
    // A user edit is a direct authorship act. If it is the only thing blocking
    // an otherwise-valid action, record it as a declaration and retry once.
    if (checked.status === "rejected" && checked.reason === "non_verbatim_text" && proposal.state === "edited") {
      const userChecked = inspectAction(action, {
        actor: "user_canvas",
        store: mapStoreRef.current,
        bank: stateRef.current.bank,
        requireConnectionLabel,
      });
      if (userChecked.status === "ready") {
        captureMapUndo();
        capturedUndo = true;
        action = groundEditedAction(action);
        checked = inspectAction(action, { actor: "user_canvas", store: mapStoreRef.current, bank: stateRef.current.bank, requireConnectionLabel });
      } else {
        checked = userChecked;
      }
    }
    if (checked.status === "needs_input" || checked.status === "needs_reference_choice" || checked.status === "needs_relationship_label") {
      const completion = checked.status === "needs_relationship_label"
        ? { kind: "relationship_label" as const, pairingProof: checked.pairingProof, pairingOrigin: checked.pairingOrigin, options: checked.options }
        : checked.status === "needs_reference_choice"
          ? { kind: "reference_choice" as const, slot: checked.slot, candidates: checked.candidates }
          : { kind: "generic" as const, fields: checked.fields };
      setProposals((current) => updateProposal(current, proposalId, { state: "edited", detail: { kind: "map_action", action, completion } }));
      return;
    }
    if (checked.status === "rejected") {
      setProposals((current) =>
        resolveProposal(current, proposalId, "invalidated", checked.detail),
      );
      return;
    }
    if (!capturedUndo) captureMapUndo();
    const relationshipProvenance = checked.action.kind === "connect_cards"
      ? {
          pairingOrigin: proposal.detail.completion?.kind === "relationship_label"
            ? proposal.detail.completion.pairingOrigin
            : proposal.detail.pairingProof ? "user_asserted" : proposal.origin ?? "legacy_confirmed",
          labelOrigin: checked.action.labelOrigin ?? (proposal.state === "edited" ? "user_asserted" as const : proposal.origin ?? "legacy_confirmed"),
        }
      : undefined;
    const appliedOrigin = relationshipProvenance && (relationshipProvenance.pairingOrigin === "ai_suggested" || relationshipProvenance.labelOrigin === "ai_suggested")
      ? "ai_suggested" as const
      : proposal.origin ?? "legacy_confirmed";
    applyGatewayActions([checked.action], mapStoreRef.current, stateRef.current.bank, { origin: appliedOrigin, contract: proposal.contract, relationshipProvenance });
    setProposals((current) => resolveProposal(current, proposalId, "confirmed"));
    void recordEvent("proposal_resolved", { proposalId, decision: "confirmed" }, { origin: proposal.origin, outcome: "confirmed" });
    void recordEvent("map_mutated", { proposalId, action: checked.action }, { origin: proposal.origin, outcome: "applied" });
    setCommandAck({ text: "Map change confirmed." });
    const event: DiagnosticEvent = { id: `d_${Date.now()}`, at: Date.now(), stage: "application", outcome: "applied", code: "map_action_applied", detail: "The confirmed proposal was revalidated against the current map and applied." };
    setDiagnostics((current) => [...current, event].slice(-100));
    markMapChanged();
    // A confirmation is meaningful user steering. Give the coach a fresh turn
    // against the already-updated map, without manufacturing chat text or
    // treating the decision as new source material.
    void requestMode(undefined, { proposalKind: "map_action", decision: "confirmed" }, mapRevision + 1);
  }, [captureMapUndo, groundEditedAction, mapRevision, markMapChanged, proposals, recordEvent, requestMode, requireConnectionLabel]);

  const dismissTrackedIdea = useCallback((ideaId: string) => {
    stateRef.current.candidates.delete(ideaId);
    stateRef.current.dismissedCandidateIds = Array.from(
      new Set([...stateRef.current.dismissedCandidateIds, ideaId]),
    );
    setUnderstandingSnapshot((prev) =>
      prev
        ? {
            ...prev,
            trackedIdeas: prev.trackedIdeas.filter((idea) => idea.id !== ideaId),
          }
        : prev,
    );
  }, []);

  // What the interface renders in, plus the read-only translated view over it.
  // The write language never restricts input (see ./language.ts).
  const [language, setLanguage] = useState<LanguageState>(() =>
    restoreLanguageState(persistedSession?.writingLanguage),
  );
  const [translations, setTranslations] = useState<Map<string, string>>(new Map());
  // Two translators (per-string lookup, whole-page DOM pass) finish at different
  // times; separate flags stop one clearing the banner while the other runs.
  const [lookupTranslating, setLookupTranslating] = useState(false);
  // Interface copy is instant, so only content translation can be "in progress".
  const translating = lookupTranslating;
  const [translateError, setTranslateError] = useState("");
  /** The one boolean that gates editing: a translated view is a reader's copy. */
  const readOnlyView = isReadOnlyView(language);

  /**
   * Content is only ever stored in the write language, so the write language may
   * only move while there is nothing stored. It locks on the first card or the
   * first chat message and unlocks again once both are empty — derived, never
   * tracked, so clearing by any route unlocks it without extra bookkeeping.
   */
  const isWriteLocked = useMemo(
    () => msgs.length > 0 || mapStoreRef.current.getAll().length > 0,
    [msgs.length, mapRevision],
  );

  // Draft panel state
  const [draftText, setDraftText] = useState(initialDraftText);
  const [draftHtml, setDraftHtml] = useState(initialDraftHtml);
  const [draftCollapsed, setDraftCollapsed] = useState(initialDraftCollapsed);
  const [draftDocked, setDraftDocked] = useState(initialDraftDocked);
  const [draftDockTargetActive, setDraftDockTargetActive] = useState(false);
  const [draftPos, setDraftPos] = useState<DraftPanelPos>(initialDraftPos);
  const [draftSize, setDraftSize] = useState<DraftPanelSize>(initialDraftSize);
  // Where the collapsed chip sat before it was expanded, so collapsing returns
  // it there instead of leaving it at the (shifted) panel position.
  const preExpandChipPosRef = useRef<DraftPanelPos | null>(null);
  const draftPanelRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);

  // What the entire page renders in: the writing language by default, or a
  // reader's language while a translation is being shown.
  const displayLanguageCode = effectiveLanguage(language);
  // Only the writer's content is paid for, and only while a reader's view is on
  // screen. Interface copy is handled separately and for free (useInterfaceLanguage).
  const pageNeedsTranslation = readOnlyView;

  // Held in a ref so a re-render never rebuilds it.
  const engineRef = useRef(openAiEngine());

  // Strings asked for during render but not translated yet. Held in a ref so
  // that asking costs nothing; the flush effect below picks them up after the
  // render completes.
  const pendingTranslationRef = useRef<Set<string>>(new Set());
  // Strings already sent to the engine, so re-renders do not ask again.
  const inFlightTranslationRef = useRef<Set<string>>(new Set());
  // Identifies the current view. A response from an earlier language must not
  // be written into the map after the user has switched again.
  const translationRunRef = useRef(0);

  /**
   * The page-wide lookup. Everything rendered anywhere — a card, a recap line,
   * a chat bubble — passes through here. Strings with no translation yet are
   * queued, and the original shows until the translation lands.
   *
   * Enumerating every translatable string up front is not workable across the
   * map and the Control Room, so translation is demand-driven instead.
   */
  const translate = useCallback(
    (text: string): string => {
      if (!pageNeedsTranslation || !text || !text.trim()) return text;
      const hit = translations.get(text);
      if (hit !== undefined) return hit;
      pendingTranslationRef.current.add(text);
      return text;
    },
    [pageNeedsTranslation, translations],
  );

  // Drop everything when the view changes, so text in one language is never
  // left on screen while another is being fetched.
  useEffect(() => {
    pendingTranslationRef.current.clear();
    inFlightTranslationRef.current.clear();
    translationRunRef.current += 1;
    setTranslations(new Map());
    setTranslateError("");
    setLookupTranslating(false);
  }, [pageNeedsTranslation, displayLanguageCode]);

  // Deliberately dependency-free: it runs after every render and flushes what
  // that render asked for. It exits immediately when the queue is empty, which
  // is the steady state once everything on screen has been translated.
  useEffect(() => {
    if (!pageNeedsTranslation) return;
    // Renders keep happening while a request is open, and each one re-queues the
    // strings it still has no translation for. Without the in-flight set every
    // piece of content is paid for twice.
    const pending = Array.from(pendingTranslationRef.current).filter(
      (text) => !translations.has(text) && !inFlightTranslationRef.current.has(text),
    );
    if (pending.length === 0) return;
    pendingTranslationRef.current.clear();
    for (const text of pending) inFlightTranslationRef.current.add(text);

    const run = translationRunRef.current;
    setLookupTranslating(true);
    translateContent(pending, displayLanguageCode, engineRef.current, (entries) => {
      // Show each piece as it lands rather than holding the whole screen back
      // until the slowest one returns.
      if (translationRunRef.current !== run) return;
      setTranslations((current) => {
        const next = new Map(current);
        for (const [original, translated] of entries) next.set(original, translated);
        return next;
      });
    })
      .catch((error: unknown) => {
        if (translationRunRef.current !== run) return;
        setTranslateError(error instanceof Error ? error.message : "Translation failed.");
      })
      .finally(() => {
        for (const text of pending) inFlightTranslationRef.current.delete(text);
        if (translationRunRef.current === run) setLookupTranslating(false);
      });
  });

  // Interface copy — section headers, buttons, Control Room labels — that no
  // per-string call site could reach. Static dictionary only: free and instant.
  const translationRoot = useCallback(() => document.body, []);
  useInterfaceLanguage({
    root: translationRoot,
    active: displayLanguageCode !== "en",
    target: displayLanguageCode,
  });

  const translationView = useMemo(
    () => ({ readOnly: readOnlyView, translate }),
    [readOnlyView, translate],
  );

  // The coach's question-anchor highlight is drawn with a REAL DOM selection (to
  // reveal/scroll the span). That must never be mistaken for a selection the user
  // made — otherwise "Reflect this back" reflects a span the user never touched.
  const anchorSelectionTextRef = useRef<string | undefined>(undefined);

  const updateDraftSelectionFocus = useCallback(() => {
    const editor = draftRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setDraftSelectionFocus(undefined);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      setDraftSelectionFocus(undefined);
      return;
    }
    const text = selection.toString().trim();
    const anchor = anchorSelectionTextRef.current?.trim();
    if (text && anchor && text === anchor) {
      // This is the coach's anchor highlight, not the user's own selection.
      setDraftSelectionFocus(undefined);
      return;
    }
    setDraftSelectionFocus(text ? { text } : undefined);
  }, []);

  const syncDraftFromEditor = useCallback((editor: HTMLDivElement) => {
    const html = sanitizeDraftHtml(editor.innerHTML);
    setDraftHtml(html);
    setDraftText(draftHtmlToPlainText(html));
  }, []);

  const handleDraftInput = useCallback((event: FormEvent<HTMLDivElement>) => {
    syncDraftFromEditor(event.currentTarget);
    setDraftSelectionFocus(undefined);
  }, [syncDraftFromEditor]);

  const handleDraftPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    const plainText = event.clipboardData.getData("text/plain");
    const html = event.clipboardData.getData("text/html");
    const pastedHtml = normalizeDraftPasteHtml(plainText, html);
    if (!pastedHtml) return;

    event.preventDefault();
    insertDraftHtmlAtSelection(event.currentTarget, pastedHtml);
    syncDraftFromEditor(event.currentTarget);
    setDraftSelectionFocus(undefined);
  }, [syncDraftFromEditor]);

  useEffect(() => {
    const editor = draftRef.current;
    if (!editor) return;
    if (editor.innerHTML !== draftHtml && (draftHtml === "" || document.activeElement !== editor)) {
      editor.innerHTML = draftHtml;
    }
    // readOnlyView is a dependency because leaving the translated view remounts
    // an empty editor; without a re-sync the draft would render blank.
  }, [draftCollapsed, draftHtml, readOnlyView]);

  // Position draft panel once window is available
  useEffect(() => {
    if (persistedSession) return;
    const size = clampDraftSize({ w: 440, h: 340 });
    setDraftSize(size);
    setDraftPos(defaultDraftPosition(size));
  }, [persistedSession]);

  useEffect(() => {
    const onResize = () => {
      setDraftSize((currentSize) => {
        const nextSize = clampDraftSize(currentSize);
        setDraftPos((currentPos) => clampDraftPosition(currentPos, nextSize));
        return nextSize;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Sync draft text into controller state
  useEffect(() => {
    stateRef.current.draft = draftText;
  }, [draftText]);

  // Drag logic
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX - draftPos.x;
    const startY = e.clientY - draftPos.y;
    const onMove = (ev: MouseEvent) => {
      setDraftPos(clampDraftPosition(
        { x: ev.clientX - startX, y: ev.clientY - startY },
        draftSize,
      ));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [draftPos, draftSize]);

  // Collapsed draft chip: drag to move, click (no drag) to expand. A small
  // movement threshold separates a deliberate drag from a click.
  const onChipMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX - draftPos.x;
    const startY = e.clientY - draftPos.y;
    const downX = e.clientX;
    const downY = e.clientY;
    let moved = false;
    let overDockTarget = false;
    let lastX = e.clientX;
    let lastY = e.clientY;
    const isOverDockTarget = (clientX: number, clientY: number): boolean => {
      const header = document.querySelector(".map-header");
      if (!(header instanceof HTMLElement)) return false;
      const rect = header.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    };
    const onMove = (ev: MouseEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      if (Math.abs(ev.clientX - downX) > 4 || Math.abs(ev.clientY - downY) > 4) moved = true;
      overDockTarget = isOverDockTarget(ev.clientX, ev.clientY);
      setDraftDockTargetActive(overDockTarget);
      // Clamp to the chip's own footprint so it can reach every edge/corner.
      setDraftPos(clampBoxPosition(
        { x: ev.clientX - startX, y: ev.clientY - startY },
        DRAFT_CHIP_WIDTH,
        DRAFT_CHIP_HEIGHT,
      ));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const shouldDock = moved && (overDockTarget || isOverDockTarget(lastX, lastY));
      setDraftDockTargetActive(false);
      if (shouldDock) {
        setDraftDocked(true);
        setDraftCollapsed(true);
        return;
      }
      if (!moved) {
        // Expand into available space: keep the whole panel on-screen, shifting
        // up/left when the chip sits near a bottom/right edge. Remember the
        // chip's spot so collapsing can return it here.
        setDraftPos((prev) => {
          preExpandChipPosRef.current = prev;
          return clampBoxPosition(prev, draftSize.w, draftSize.h);
        });
        setDraftCollapsed(false);
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [draftPos, draftSize]);

  // Drag-out of the docked-draft pill: press-and-drag lifts it off the toolbar.
  const onDockedDraftMouseDown = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const downX = e.clientX;
    const downY = e.clientY;
    let moved = false;
    let lastX = e.clientX;
    let lastY = e.clientY;

    const isOverDockTarget = (clientX: number, clientY: number): boolean => {
      const header = document.querySelector(".map-header");
      if (!(header instanceof HTMLElement)) return false;
      const headerRect = header.getBoundingClientRect();
      return (
        clientX >= headerRect.left &&
        clientX <= headerRect.right &&
        clientY >= headerRect.top &&
        clientY <= headerRect.bottom
      );
    };

    const onMove = (ev: MouseEvent) => {
      lastX = ev.clientX;
      lastY = ev.clientY;
      const didMove = Math.abs(ev.clientX - downX) > 4 || Math.abs(ev.clientY - downY) > 4;
      if (!didMove) return;
      moved = true;
      setDraftDocked(false);
      setDraftCollapsed(true);
      setDraftDockTargetActive(isOverDockTarget(ev.clientX, ev.clientY));
      setDraftPos(clampBoxPosition(
        { x: ev.clientX - startX, y: ev.clientY - startY },
        DRAFT_CHIP_WIDTH,
        DRAFT_CHIP_HEIGHT,
      ));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setDraftDockTargetActive(false);

      if (!moved) {
        setDraftDocked(false);
        setDraftCollapsed(false);
        return;
      }

      if (isOverDockTarget(lastX, lastY)) {
        setDraftDocked(true);
        setDraftCollapsed(true);
        return;
      }

      setDraftDocked(false);
      setDraftCollapsed(true);
      setDraftPos(clampBoxPosition(
        { x: lastX - startX, y: lastY - startY },
        DRAFT_CHIP_WIDTH,
        DRAFT_CHIP_HEIGHT,
      ));
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  const startResize = useCallback((
    e: React.MouseEvent,
    edges: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean },
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const ox = e.clientX, oy = e.clientY;
    const px = draftPos.x, py = draftPos.y;
    const pw = draftSize.w, ph = draftSize.h;
    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - ox, dy = ev.clientY - oy;
      let newW = pw, newH = ph, newX = px, newY = py;
      if (edges.right)  newW = Math.max(220, pw + dx);
      if (edges.bottom) newH = Math.max(120, ph + dy);
      if (edges.left)  { newW = Math.max(220, pw - dx); newX = px + pw - newW; }
      if (edges.top)   { newH = Math.max(120, ph - dy); newY = py + ph - newH; }
      const nextSize = clampDraftSize({ w: newW, h: newH });
      setDraftSize(nextSize);
      setDraftPos(clampDraftPosition({ x: newX, y: newY }, nextSize));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [draftPos, draftSize]);

  // Only the latest assistant turn may offer an anchor. Older anchors must not
  // keep resurfacing after the conversation has moved on.
  const activeAnchor = [...msgs].reverse().find((m) => m.role === "assistant")?.questionAnchor;

  // An unsolicited model anchor is a quiet offer, not permission to open or
  // move the user's draft. If the draft is already open, it is highlighted;
  // otherwise the visible dot and "View passage" control let the user opt in.
  const [highlightAnchor, setHighlightAnchor] = useState<string | undefined>(undefined);
  useEffect(() => {
    setHighlightAnchor(activeAnchor);
  }, [activeAnchor]);

  // When the highlight lands, select and scroll the rich draft text into view.
  // Record the anchor text so the selection handler can tell this app-created
  // selection apart from one the user actually made.
  useEffect(() => {
    anchorSelectionTextRef.current = highlightAnchor;
    if (!highlightAnchor || draftDocked || draftCollapsed) return;
    const editor = draftRef.current;
    if (editor) selectTextInElement(editor, highlightAnchor);
  }, [highlightAnchor, draftHtml, draftDocked, draftCollapsed]);

  // Cards the current coach turn refers to (by #ref) - highlighted on the map.
  const referencedCardIds = useMemo(() => {
    const last = [...msgs].reverse().find((m) => m.role === "assistant");
    const refs = new Set(last?.text.match(/#\d+/g) ?? []);
    if (refs.size === 0) return undefined;
    const ids = new Set<string>();
    for (const unit of mapStoreRef.current.getAll()) {
      if (refs.has(cardRef(unit.id))) ids.add(unit.id);
    }
    return ids.size > 0 ? ids : undefined;
  }, [msgs, mapRevision]);

  const rootCardIds = useMemo(() => {
    return new Set(
      mapStoreRef.current
        .getAll()
        .filter((unit) => !unit.parentId && unit.role !== "connection_label")
        .map((unit) => unit.id),
    );
  }, [mapRevision]);

  useEffect(() => {
    setContextSelectedCardIds((current) => {
      const pruned = pruneContextSelection(current, rootCardIds);
      return pruned.size === current.size && Array.from(pruned).every((id) => current.has(id))
        ? current
        : pruned;
    });
  }, [rootCardIds]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextSelectedCardIds(new Set());
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleContextCard = useCallback((id: string) => {
    if (!rootCardIds.has(id)) return;
    setContextSelectedCardIds((current) => toggleContextSelection(current, id));
  }, [rootCardIds]);

  const clearContextSelection = useCallback(() => {
    setContextSelectedCardIds(new Set());
  }, []);

  const selectedFocus = useMemo<SelectedFocusContext | undefined>(() => {
    const cards = mapStoreRef.current
      .getAll()
      .filter((unit) => contextSelectedCardIds.has(unit.id) && !unit.parentId && unit.role !== "connection_label")
      .map((unit) => ({
        id: unit.id,
        ref: cardRef(unit.id),
        text: unit.text,
        role: unit.role as Exclude<ThoughtUnitRole, "connection_label">,
      }));
    const draftText = stickyDraftFocus?.text.trim() || draftSelectionFocus?.text.trim();
    if (cards.length === 0 && !draftText) return undefined;
    return {
      ...(cards.length > 0 ? { cards } : {}),
      ...(draftText ? { draftText } : {}),
    };
  }, [contextSelectedCardIds, draftSelectionFocus, mapRevision, stickyDraftFocus]);

  // Deterministic recap for the Control Room "Recap" view. Recomputed when the
  // conversation or map changes. `ai_suggested` origin = AI-originated; else yours.
  const recapData = useMemo<RecapData>(() => {
    const units = mapStoreRef.current.getAll().filter((unit) => unit.role !== "connection_label");
    const aiCards = units.filter((unit) => unit.source.origin === "ai_suggested");
    const connections = mapStoreRef.current.getConnections();
    // Walk msgs in order so each user turn carries what the coach offered just
    // before it (the AI move the user was responding to).
    const turnBeats: Array<{ text: string; coachKind?: string }> = [];
    const turnLevels: AssistanceLevel[] = [];
    let lastCoachKind: string | undefined;
    let suggestionsOffered = 0;
    for (const message of msgs) {
      if (message.role === "assistant") {
        lastCoachKind = message.comparison
          ? "compare"
          : message.responseKind ?? (message.mode === "mirror" ? "reflection" : "question");
        if (message.responseKind === "suggestion") suggestionsOffered += 1;
      } else if (message.role === "user" && message.text.trim()) {
        turnBeats.push({ text: message.text, coachKind: lastCoachKind });
        // Turns recorded before per-turn level tracking fall back to the current level.
        turnLevels.push(message.level ?? assistanceLevel);
      }
    }
    // Dominant level = the one the writer spent the most turns under (ties: earliest used).
    const levelCounts = new Map<AssistanceLevel, number>();
    for (const level of turnLevels) levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
    let dominantLevel: AssistanceLevel = assistanceLevel;
    let maxCount = -1;
    for (const [level, count] of levelCounts) {
      if (count > maxCount) { maxCount = count; dominantLevel = level; }
    }
    return {
      turnCount: turnBeats.length,
      dominantLevelLabel: contractForLevel(dominantLevel).label,
      currentLevelLabel: contract.label,
      // Only flag a switch when the level you used most differs from the one you're on now —
      // otherwise "mostly → now" would redundantly show the same label twice.
      levelSwitched: dominantLevel !== assistanceLevel,
      cardsTotal: units.length,
      yourCards: units.length - aiCards.length,
      aiCards: aiCards.length,
      suggestionsOffered,
      connectionCount: connections.length,
      timeline: turnBeats.map((beat) => beat.text),
      turnBeats,
      built: units.map((unit) => ({ text: unit.text, ai: unit.source.origin === "ai_suggested" })),
    };
  }, [msgs, mapRevision, contract.label, assistanceLevel]);

  // Group the user's turns into focus episodes for the Recap timeline. AI does the
  // grouping and picks each label, but the label is forced to be the user's OWN
  // verbatim words (extractive) — never a paraphrase. Falls back to one episode
  // per turn if the model is unavailable. Called on-demand and cached by the panel.
  const segmentThinking = useCallback(async (beats: Array<{ text: string; coachKind?: string }>): Promise<ThinkingSegment[]> => {
    const turns = beats.map((beat) => beat.text);
    let raw: Array<{ start: number; end: number; label: string; subIdeas: string[] }>;
    try {
      raw = await segmentUserTurns(turns);
      if (raw.length === 0) throw new Error("empty");
    } catch {
      raw = turns.map((_, index) => ({ start: index + 1, end: index + 1, label: turns[index], subIdeas: [] }));
    }
    const cards = mapStoreRef.current.getAll().filter((unit) => unit.role !== "connection_label");
    return raw.map((segment) => {
      const span = turns.slice(segment.start - 1, segment.end).join(" ");
      const spanLower = span.toLowerCase();
      const label = spanLower.includes(segment.label.toLowerCase())
        ? segment.label.trim()
        : firstWords(span, 9);
      // Keep only sub-ideas that are genuinely the writer's own words (verbatim
      // substrings of the span), distinct from the big-idea label, and substantive:
      // drop bare agreement/negation and one/two-word fragments. Cap to the top few.
      const labelLower = label.toLowerCase();
      const subIdeas = segment.subIdeas
        .map((sub) => sub.trim())
        .filter((sub) => sub.length > 0 && spanLower.includes(sub.toLowerCase()) && sub.toLowerCase() !== labelLower)
        .filter((sub) => !isTrivialSubIdea(sub))
        .filter((sub, index, all) => all.findIndex((other) => other.toLowerCase() === sub.toLowerCase()) === index)
        .slice(0, 3);
      const key = label.replace(/…$/, "").trim().toLowerCase();
      const matched =
        key.length > 3
          ? cards.find((card) => {
              const cardText = card.text.toLowerCase();
              return cardText.includes(key) || key.includes(cardText);
            })
          : undefined;
      return {
        start: segment.start,
        end: segment.end,
        label,
        subIdeas,
        coachKind: beats[segment.start - 1]?.coachKind,
        onMap: Boolean(matched),
        aiOrigin: matched?.source.origin === "ai_suggested",
      };
    });
  }, []);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const turnNonceRef = useRef(0);
  const speech = useSpeechToText();

  // Scroll to bottom on new messages.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  useEffect(() => {
    const maxSeen = msgs.reduce((max, msg) => Math.max(max, msg.id), 0);
    msgId = Math.max(msgId, maxSeen);
  }, [msgs]);

  useEffect(() => {
    if (!speech.transcript && !speech.interim) return;
    const liveTranscript = `${speech.transcript} ${speech.interim}`.trim();
    setInput(liveTranscript);
  }, [speech.interim, speech.transcript]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const maxHeight = 220;
    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${nextHeight}px`;
    setComposerScrollable(textarea.scrollHeight > maxHeight);
  }, [input]);

  function appendCoachOutput(out: TurnResult, opts?: { replaceLastCoach?: boolean }) {
    const nextDiagnostics = [...diagnostics, ...out.diagnostics].slice(-100);
    setDiagnostics(nextDiagnostics);
    const understanding = buildDiagnosticSnapshot(out.diagnostics, stateRef.current.candidates.getAll());
    const replaceLastCoach =
      Boolean(opts?.replaceLastCoach) &&
      msgs.length > 0 &&
      msgs[msgs.length - 1].role === "assistant";
    const replacedProposalId = replaceLastCoach ? msgs[msgs.length - 1].proposalId : undefined;
    if (replacedProposalId) {
      setProposals((current) => resolveProposal(current, replacedProposalId, "cancelled"));
    }
    setLastCoachDebug({
      mode: out.response?.kind ?? "idle",
      commandDebug: out.diagnostics.map((event) => ({ reason: event.code, detail: event.detail })),
    });

    if (!out.response) {
      setUnderstandingSnapshot(understanding);
      return;
    }

    void recordEvent("assistant_response", out.response, { responseKind: out.response.kind });
    if (out.proposal) {
      void recordEvent("proposal_created", out.proposal, { origin: out.proposal.origin, responseKind: out.response.kind });
      if (out.proposal.influenceTrace?.exactOverlapPhrases.length) void recordEvent("assistant_echo_overlap", out.proposal.influenceTrace, { origin: out.proposal.origin });
    }

    const newMsg: ChatMsg = {
      id: ++msgId,
      role: "assistant",
      text: out.response.text,
      mode: out.response.kind === "reflection" ? "mirror" : "question",
      responseKind: out.response.kind,
      questionAnchor: out.response.kind === "question" ? out.response.anchor : undefined,
      questionStance: out.response.kind === "question" ? out.response.stance : undefined,
    };

    if (out.proposal) {
      newMsg.proposalId = out.proposal.id;
      setProposals((current) => {
        const next = new Map(current);
        next.set(out.proposal!.id, { ...out.proposal!, messageId: newMsg.id });
        return next;
      });
    }
    setMsgs((prev) => {
      if (replaceLastCoach && prev.length > 0 && prev[prev.length - 1].role === "assistant") {
        return [...prev.slice(0, -1), newMsg];
      }
      return [...prev, newMsg];
    });
    setUnderstandingSnapshot(understanding);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const snapshot: PersistedSession = {
      version: 6,
      sessionId: initialSessionId,
      assistanceLevel,
      // Only a chosen language is worth storing; the view language is dropped so
      // a reload resumes on the writer's own words, not in a read-only projection.
      writingLanguage: language.chosen ? language.writeLanguage : undefined,
      msgs,
      proposals: Array.from(proposals.values()),
      confirmed,
      lastCoachDebug,
      understandingSnapshot,
      mapRevision,
      questionBias,
      requireConnectionLabel,
      draftText,
      draftHtml,
      draftCollapsed,
      draftDocked,
      draftPos,
      draftSize,
      stickyDraftFocus,
      conversation: {
        turnsSinceLastReflection: stateRef.current.turnsSinceLastReflection,
        lastAssistantText: stateRef.current.lastAssistantText,
        draft: stateRef.current.draft,
        dismissedCandidateIds: stateRef.current.dismissedCandidateIds,
        openThreads: stateRef.current.openThreads,
      },
      diagnostics,
      bank: stateRef.current.bank.getAll(),
      candidates: stateRef.current.candidates.getAll(),
      map: mapStoreRef.current.snapshot(),
    };
    try {
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Persistence is best-effort. A full quota (long session, large draft
      // HTML/map) or a storage-blocked context (private mode) must not throw
      // out of this effect and blank the app — the load path already fails soft.
    }
  }, [
    confirmed,
    diagnostics,
    draftCollapsed,
    draftDocked,
    draftHtml,
    draftPos,
    draftSize,
    draftText,
    language,
    lastCoachDebug,
    understandingSnapshot,
    mapRevision,
    msgs,
    proposals,
    questionBias,
    assistanceLevel,
    requireConnectionLabel,
    stickyDraftFocus,
  ]);

  async function send() {
    const text = input.trim();
    // Sending is a content change, so it is refused in a translated view for the
    // same reason every map mutation is (see Map.tsx's dispatch guard).
    if (!text || loading || readOnlyView) return;
    // Input is never constrained by language. The writing language chooses what
    // the interface is rendered in — it is a display setting the writer owns,
    // not a rule about what they may type. The only state that stops input is a
    // translated view (write !== view), which is read-only by construction.
    const nonce = ++turnNonceRef.current;
    const selectedCardIds = Array.from(contextSelectedCardIds).filter((id) => {
      const card = mapStoreRef.current.get(id);
      return Boolean(card && !card.parentId && card.role !== "connection_label");
    });

    speech.stop();
    setInput("");
    setError(null);
    speech.reset();
    // Consume-once: this typed message DOES use the current yellow-selected focus
    // (so "select a card, then ask about this" works), then the selection is
    // cleared so it can't silently scope the NEXT, unrelated turn. `selectedFocus`
    // is captured from this render, so clearing here doesn't affect the call below.
    setContextSelectedCardIds(new Set());
    setDraftSelectionFocus(undefined);

    const userMessage: ChatMsg = { id: ++msgId, role: "user", text, level: assistanceLevel };
    // React state is asynchronous. Construct the provider transcript here so
    // this exact user turn is present once, in final dialogue position, on the
    // very request it triggered.
    const turnHistory = historyForCurrentTurn(buildConversationHistory(msgs), text);
    setMsgs((prev) => [...prev, userMessage]);

    setLoading(true);
    try {
      if (compareMode) {
        // Comparison preview: one call, one answer per contract level, on a
        // throwaway clone. Nothing is committed — the map/state does not advance;
        // this is purely to see how L0/L1/L2 differ on this input.
        void recordEvent("user_message", { text, compare: true });
        const previewState = cloneConversationState(stateRef.current);
        const added = previewState.bank.addSegmented(text, "chat");
        const context = buildContext(
          previewState,
          text,
          added,
          mapStoreRef.current.toLLMContext(),
          configRef.current,
          selectedFocus,
          undefined,
          undefined,
        );
        const results = await compareAssistanceLevels(context, turnHistory);
        if (nonce !== turnNonceRef.current) return;
        const comparisonId = ++msgId;
        // Keep the ingested working state so "Continue with this" can replay the
        // exact chosen response on the same bank (no regeneration, ids match).
        comparePreviewRef.current.set(comparisonId, { state: previewState, results });
        setMsgs((prev) => [...prev, { id: comparisonId, role: "assistant", text: "", comparison: results, comparisonUserText: text }]);
        void recordEvent("compare_turn", {
          results: results.map((r) => ({ level: r.level, kind: r.kind, text: r.text, options: r.options })),
          levels: results.map((r) => ({ level: r.level, kind: r.kind, rejections: r.rejectionReasons })),
        });
        return;
      }

      const workingState = cloneConversationState(stateRef.current);
      void recordEvent("user_message", { text });
      const requestedTools: Array<{ name: "propose_reflection_v1" | "propose_map_action_v1"; callId?: string; round: number }> = [];
      let providerResponseCount = 0;
      const out = await processTurn(
        workingState,
        text,
        makeLLM(() => configRef.current, turnHistory, (trace) => {
          const round = providerResponseCount++;
          void recordEvent("model_request", { messages: trace.messages, model: trace.model, reasoningEffort: trace.reasoningEffort, responseId: trace.responseId }, { providerTransport: trace.transport });
          if (trace.toolName) { requestedTools.push({ name: trace.toolName, callId: trace.toolCallId, round }); void recordEvent("provider_tool_requested", { toolName: trace.toolName, callId: trace.toolCallId, providerResponse: trace.parsedProviderResponse }, { providerTransport: trace.transport, toolName: trace.toolName }); }
          void recordEvent("assistant_response", { parsedProviderResponse: trace.parsedProviderResponse, responseId: trace.responseId, outputItemTypes: trace.outputItemTypes }, { providerTransport: trace.transport, toolName: trace.toolName });
        }),
        configRef.current,
        mapStoreRef.current.toLLMContext(),
        { mapRevision, requireConnectionLabel, selectedFocus, selectedCardIds, store: mapStoreRef.current, contract, priorAssistant: [...msgs].reverse().find((message) => message.role === "assistant") },
      );
      const last = out.diagnostics[out.diagnostics.length - 1];
      const firstRejection = out.diagnostics.find((event) => event.outcome === "rejected");
      requestedTools.forEach((tool) => {
        const terminal = tool.round === providerResponseCount - 1;
        void recordEvent("provider_tool_result", { toolName: tool.name, callId: tool.callId, diagnostics: out.diagnostics }, { providerTransport: "responses_tools", toolName: tool.name, outcome: terminal ? last?.outcome : "rejected", code: terminal ? last?.code : firstRejection?.code });
      });

      if (nonce !== turnNonceRef.current) return;
      mergeConversationBank(workingState, stateRef.current);
      stateRef.current = workingState;
      for (const event of out.diagnostics) void recordEvent("contract_decision", event, { outcome: event.outcome, code: event.code });
      appendCoachOutput(out);
    } catch (e) {
      if (nonce !== turnNonceRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      if (nonce === turnNonceRef.current) setLoading(false);
    }
  }

  // Pick one contract level from a comparison preview and continue under it: switch
  // the session to that level, drop the read-only preview, and run a real turn for
  // the same user message through the full pipeline (a fresh call — the preview was
  // never committed). The committed answer replaces the preview.
  async function continueWithLevel(messageId: number, level: AssistanceLevel, userText: string) {
    if (loading) return;
    const entry = comparePreviewRef.current.get(messageId);
    const chosen = entry?.results.find((result) => result.level === level);
    const nonce = ++turnNonceRef.current;
    setError(null);
    setAssistanceLevel(level); // continue the session at the chosen level; compare mode stays on
    void recordEvent(
      "contract_changed",
      { from: assistanceLevel, to: level, reason: "continue_from_compare" },
      { contract: snapshotContract(contractForLevel(level)) },
    );
    const priorAssistant = [...msgs].reverse().find((message) => message.role === "assistant" && message.text && message.id !== messageId);
    const remaining = msgs.filter((message) => message.id !== messageId);
    setMsgs((prev) => prev.filter((message) => message.id !== messageId));
    comparePreviewRef.current.delete(messageId);
    setLoading(true);
    try {
      const chosenContract = contractForLevel(level);
      let out: TurnResult | undefined;

      // 1) Replay the EXACT previewed response on the state it was generated against
      //    (this turn's words already ingested → grounding ids line up); no new call.
      if (entry && chosen?.response) {
        const response = chosen.response;
        const replayed = await processTurn(
          entry.state,
          "",
          async () => ({ response }),
          configRef.current,
          mapStoreRef.current.toLLMContext(),
          { mapRevision, requireConnectionLabel, store: mapStoreRef.current, contract: chosenContract, priorAssistant },
        );
        if (nonce !== turnNonceRef.current) return;
        // Only adopt the replay if it actually committed a visible response. A
        // grounded response the model didn't cite perfectly is rejected by the
        // contract gate and would otherwise leave the user with silence.
        if (replayed.response) {
          out = replayed;
          stateRef.current = entry.state;
        }
      }

      // 2) Fallback: no cached preview (e.g. after reload), or the exact replay could
      //    not be committed — run a fresh turn at this level so there is always a reply.
      if (!out) {
        const turnHistory = historyForCurrentTurn(buildConversationHistory(remaining), undefined);
        const workingState = cloneConversationState(stateRef.current);
        out = await processTurn(
          workingState,
          userText,
          makeLLM(() => configRef.current, turnHistory),
          configRef.current,
          mapStoreRef.current.toLLMContext(),
          { mapRevision, requireConnectionLabel, store: mapStoreRef.current, contract: chosenContract, priorAssistant },
        );
        if (nonce !== turnNonceRef.current) return;
        mergeConversationBank(workingState, stateRef.current);
        stateRef.current = workingState;
      }

      for (const event of out.diagnostics) void recordEvent("contract_decision", event, { outcome: event.outcome, code: event.code });
      appendCoachOutput(out);
    } catch (e) {
      if (nonce !== turnNonceRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (nonce === turnNonceRef.current) setLoading(false);
    }
  }

  // Runs a coach-only turn without synthetic user text. A panel request replaces
  // its prior coach move; a completed proposal appends a genuine continuation.
  async function requestMode(mode?: UserRequestedMode, proposalOutcome?: ProposalOutcomeContext, currentMapRevision = mapRevision) {
    if (loading) return;
    const nonce = ++turnNonceRef.current;

    speech.stop();
    setError(null);

    setLoading(true);
    try {
      const workingState = cloneConversationState(stateRef.current);
      // The Stage 1 loop has no regex-routed forced modes. This remains a
      // visible user request for a fresh coach move, not a controller override.
      const requestedTools: Array<{ name: "propose_reflection_v1" | "propose_map_action_v1"; callId?: string; round: number }> = [];
      let providerResponseCount = 0;
      const out = await processTurn(
        workingState,
        "",
        makeLLM(() => configRef.current, buildConversationHistory(msgs), (trace) => {
          const round = providerResponseCount++;
          void recordEvent("model_request", { messages: trace.messages, model: trace.model, reasoningEffort: trace.reasoningEffort, responseId: trace.responseId }, { providerTransport: trace.transport });
          if (trace.toolName) { requestedTools.push({ name: trace.toolName, callId: trace.toolCallId, round }); void recordEvent("provider_tool_requested", { toolName: trace.toolName, callId: trace.toolCallId, providerResponse: trace.parsedProviderResponse }, { providerTransport: trace.transport, toolName: trace.toolName }); }
          void recordEvent("assistant_response", { parsedProviderResponse: trace.parsedProviderResponse, responseId: trace.responseId, outputItemTypes: trace.outputItemTypes }, { providerTransport: trace.transport, toolName: trace.toolName });
        }),
        configRef.current,
        mapStoreRef.current.toLLMContext(),
        { mapRevision: currentMapRevision, requireConnectionLabel, selectedFocus, requestedSupport: mode, proposalOutcome, store: mapStoreRef.current, contract, priorAssistant: [...msgs].reverse().find((message) => message.role === "assistant") },
      );
      const last = out.diagnostics[out.diagnostics.length - 1];
      const firstRejection = out.diagnostics.find((event) => event.outcome === "rejected");
      requestedTools.forEach((tool) => {
        const terminal = tool.round === providerResponseCount - 1;
        void recordEvent("provider_tool_result", { toolName: tool.name, callId: tool.callId, diagnostics: out.diagnostics }, { providerTransport: "responses_tools", toolName: tool.name, outcome: terminal ? last?.outcome : "rejected", code: terminal ? last?.code : firstRejection?.code });
      });

      if (nonce !== turnNonceRef.current) return;
      mergeConversationBank(workingState, stateRef.current);
      stateRef.current = workingState;
      appendCoachOutput(out, { replaceLastCoach: Boolean(mode) });
    } catch (e) {
      if (nonce !== turnNonceRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      if (nonce === turnNonceRef.current) setLoading(false);
    }
  }

  async function decideClaim(proposalId: string, claimId: string, decision: "confirmed" | "declined") {
    if (loading) return;
    const proposal = proposals.get(proposalId);
    if (!proposal || proposal.detail.kind !== "reflection" || proposal.detail.decisions[claimId] !== "pending") return;
    const reflection = proposal.detail;
    const resolution = resolveMirrorDecision(reflection.decisions, claimId, decision);

    const claim = reflection.reflection.claims.find((c) => c.id === claimId);
    const editedText = (reflection.editedTexts[claimId] ?? claim?.text ?? "").trim();
    const finalText = editedText || claim?.text;
    let confirmedReflection: ConfirmedReflection | undefined;
    if (decision === "confirmed") {
      if (claim && finalText) {
        confirmedReflection = {
          id: `cr_${Date.now()}_${claimId}`,
          text: finalText,
          candidateId: claim.candidateId,
          target: claim.target,
          sourceUtteranceIds: Array.from(
            new Set(claim.sourceSpans.flatMap((s) => s.utteranceIds)),
          ),
          confirmedAt: Date.now(),
          origin: proposal.origin,
          contract: proposal.contract,
        };
      }
    }

    if (confirmedReflection) {
      const appliedText = confirmedReflection.text;
      const wasEdited = appliedText !== claim?.text;
      if (!wasEdited && claim) {
        const validation = validateMirror({ claims: [claim] }, stateRef.current.bank.getAll(), configRef.current);
        if (!validation.ok) {
          setProposals((current) => resolveProposal(current, proposalId, "invalidated", "The reflection evidence no longer validates."));
          return;
        }
        captureMapUndo();
        applyConfirmedReflection(confirmedReflection, mapStoreRef.current);
        setConfirmed((prev) => [...prev, confirmedReflection]);
        markUserMapChanged();
        const event: DiagnosticEvent = { id: `d_${Date.now()}`, at: Date.now(), stage: "application", outcome: "applied", code: "reflection_claim_applied", detail: "Confirmed reflection claim passed the gateway and was added to the map." };
        setDiagnostics((current) => [...current, event].slice(-100));
        void recordEvent("map_mutated", { proposalId, claimId }, { origin: proposal.origin, outcome: "applied" });
      } else {
        captureMapUndo();
        const ids = [stateRef.current.bank.add(appliedText, "declaration").id];
        const action: ProposedAction = { kind: "create_card", text: appliedText, sourceUtteranceIds: ids };
        const checked = inspectAction(action, { actor: "user_canvas", store: mapStoreRef.current, bank: stateRef.current.bank });
        if (checked.status === "ready") {
          applyGatewayActions([checked.action], mapStoreRef.current, stateRef.current.bank);
          setConfirmed((prev) => [...prev, { ...confirmedReflection, sourceUtteranceIds: ids }]);
          markUserMapChanged();
        }
      }
    }
    setProposals((current) => {
      const existing = current.get(proposalId);
      if (!existing || existing.detail.kind !== "reflection") return current;
      return updateProposal(current, proposalId, { state: resolution.allDecided ? (resolution.anyConfirmed ? "confirmed" : "declined") : existing.state, detail: { ...existing.detail, decisions: resolution.nextDecisions } });
    });
    if (resolution.allDecided) {
      void recordEvent("proposal_resolved", { proposalId, decision }, { origin: proposal.origin, outcome: resolution.anyConfirmed ? "confirmed" : "declined" });
      if (resolution.shouldContinue) {
        void requestMode(undefined, { proposalKind: "reflection", decision: "confirmed" }, mapRevision + 1);
      }
    }
  }
  function editMirrorClaim(proposalId: string, claimId: string, text: string) {
    setProposals((current) => {
      const proposal = current.get(proposalId);
      if (!proposal || proposal.detail.kind !== "reflection" || proposal.detail.decisions[claimId] !== "pending") return current;
      return updateProposal(current, proposalId, { state: "edited", detail: { ...proposal.detail, editedTexts: { ...proposal.detail.editedTexts, [claimId]: text } } });
    });
  }

  function addComposerAsCard() {
    const text = input.trim();
    if (!text || loading) return;
    const utterances = stateRef.current.bank.addSegmented(text, "chat");
    const proposal: Proposal = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      mapRevision,
      referencedCardIds: [],
      origin: "user_asserted",
      contract: snapshotContract(contract),
      state: "shown",
      detail: {
        kind: "map_action",
        action: { kind: "create_card", text, sourceUtteranceIds: utterances.map((utterance) => utterance.id) },
      },
    };
    const userId = ++msgId;
    const coachId = ++msgId;
    setMsgs((previous) => [
      ...previous,
      { id: userId, role: "user", text, level: assistanceLevel },
      { id: coachId, role: "assistant", text: "Review this map change.", mode: "question", proposalId: proposal.id },
    ]);
    setProposals((current) => {
      const next = new Map(current);
      next.set(proposal.id, proposal);
      return next;
    });
    setInput("");
  }

  function onKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  function revealDraftAnchor(anchor: string) {
    setHighlightAnchor(anchor);
    setDraftDocked(false);
    setDraftCollapsed(false);
  }

  function pinDraftSelection() {
    const text = draftSelectionFocus?.text.trim();
    if (!text) return;
    // Store a text snapshot, not a DOM range: edits and selection changes must
    // not silently change the context the user deliberately pinned.
    setStickyDraftFocus({ text });
  }

  function focusSummary(text: string): string {
    const compact = text.replace(/\s+/g, " ").trim();
    return compact.length > 90 ? `${compact.slice(0, 87)}…` : compact;
  }

  function toggleDraftFromComposer() {
    if (draftDocked) {
      setDraftDocked(false);
      setDraftCollapsed(false);
      return;
    }
    setDraftDocked(true);
    setDraftCollapsed(true);
  }

  function clearMapOnly() {
    if (readOnlyView) return;
    turnNonceRef.current++;
    setLoading(false);
    mapStoreRef.current = new ThoughtUnitStore();
    undoStackRef.current = [];
    setCanUndoMap(false);
    setCommandAck(null);
    setProposals((current) => createProposalStore(Array.from(current.values()).map((proposal) => proposal.state === "shown" || proposal.state === "edited" ? { ...proposal, state: "invalidated", invalidReason: "The map was cleared." } : proposal)));
    setConfirmed([]);
    setContextSelectedCardIds(new Set());
    setStickyDraftFocus(undefined);
    setMapMountKey((key) => key + 1);
    markMapChanged();
  }

  function clearDraftOnly() {
    if (readOnlyView) return;
    turnNonceRef.current++;
    setLoading(false);
    setDraftText("");
    setDraftHtml("");
    setHighlightAnchor(undefined);
    setDraftSelectionFocus(undefined);
    setStickyDraftFocus(undefined);
    stateRef.current.draft = "";
  }

  function clearChatOnly() {
    if (readOnlyView) return;
    turnNonceRef.current++;
    setLoading(false);
    const draft = draftText;
    const referencedUtteranceIds = new Set(mapStoreRef.current.getAll().flatMap((unit) => unit.source.utteranceIds));
    const retainedMapSources = stateRef.current.bank.getAll().filter((utterance) => referencedUtteranceIds.has(utterance.id));
    stateRef.current = createConversationState();
    stateRef.current.bank.replaceAll(retainedMapSources);
    stateRef.current.draft = draft;
    setMsgs([]);
    setProposals(createProposalStore());
    setDiagnostics([]);
    setLastCoachDebug(null);
    setUnderstandingSnapshot(null);
    setHighlightAnchor(undefined);
    setStickyDraftFocus(undefined);
    undoStackRef.current = [];
    setCanUndoMap(false);
    setCommandAck(null);
    setError(null);
    setInput("");
    speech.stop();
    speech.reset();
  }

  return (
    <TranslationContext.Provider value={translationView}>
      <style>{css}</style>
      <div className="layout">
        {/* Chat panel */}
        <div className="chat-panel">
          {/* Header carries only what shapes the answer: level and framing.
              Language lives in the map tools, Clear chat by the composer. */}
          <div className="chat-header">
            <div className="control-block">
              <div className="control-block-head">
                <span className="control-block-label">Assistance</span>
              </div>
              <div className="segmented" role="radiogroup" aria-label="Assistance level">
                {([0, 1, 2] as AssistanceLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    role="radio"
                    aria-checked={assistanceLevel === level}
                    className={`segmented-option${assistanceLevel === level ? " is-active" : ""}`}
                    data-level={level}
                    title={ASSISTANCE_CONTRACTS[level].description}
                    onClick={() => {
                      if (level === assistanceLevel) return;
                      setAssistanceLevel(level);
                      void recordEvent("contract_changed", { from: assistanceLevel, to: level }, { contract: snapshotContract(contractForLevel(level)) });
                    }}
                  >
                    <span className="segmented-rank">L{level}</span>
                    <span className="segmented-name">{ASSISTANCE_CONTRACTS[level].label}</span>
                  </button>
                ))}
              </div>
              <p className="control-block-note">
                {compareMode
                  ? "Every turn is answered once per level. Nothing is committed."
                  : contract.description}
              </p>
              <button
                type="button"
                className={`compare-toggle${compareMode ? " is-active" : ""}`}
                aria-pressed={compareMode}
                title="Answer each turn once per contract level (L0/L1/L2) in one call — read-only, nothing is committed"
                onClick={() => setCompareMode((on) => !on)}
              >
                <span className="compare-toggle-mark" aria-hidden="true">{compareMode ? "◉" : "○"}</span>
                <span>Compare all 3 levels</span>
              </button>
            </div>

            {/* data-stop drives which end takes the framing hue in CSS. */}
            <div className="control-block" data-stop={questionBias}>
              <div className="control-block-head">
                <span className="control-block-label">Framing</span>
              </div>
              <label className="bias-rail">
                <span className="bias-end bias-end-think">Think</span>
                <span className="bias-track" style={{ ["--bias-fill" as string]: `${questionBias}%` }}>
                  <span className="bias-ticks" aria-hidden="true">
                    {QUESTION_BIAS_STOPS.map((stop) => (
                      <span key={stop} className={`bias-tick${stop <= questionBias ? " is-passed" : ""}`} />
                    ))}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={25}
                    value={questionBias}
                    aria-label="Question framing bias, 0 is Think and 100 is Map"
                    onChange={(event) => setQuestionBias(Number(event.target.value))}
                  />
                </span>
                <span className="bias-end bias-end-map">Map</span>
              </label>
            </div>

          </div>

          {readOnlyView && (
            <div className="translation-banner" data-no-translate>
              <span>
                Read-only translation into {languageLabel(effectiveLanguage(language))}
                {translating ? " · translating…" : ""}
                {" · "}your {languageLabel(language.writeLanguage)} words are unchanged.
              </span>
              <button
                type="button"
                onClick={() => setLanguage((current) => selectViewLanguage(current, null))}
              >
                ← Back to {languageLabel(language.writeLanguage)} to continue
              </button>
            </div>
          )}
          {readOnlyView && translateError && (
            <div className="error-banner">{translateError}</div>
          )}

          {!ledgerAvailable && <div className="error-banner">Local audit storage is unavailable in this browser.</div>}

          <div className="messages">
            {msgs.map((m) => (
              <div key={m.id} className={`msg ${m.role} ${m.mode ?? ""}`}>
                <span className="msg-label">
                  {m.role === "user" ? "you" : m.comparison ? "coach · comparing 3 contract levels" : "coach"}
                  {m.role === "assistant" && !m.comparison && <AssistantResponseKindBadge kind={m.responseKind} />}
                  {m.questionStance && (
                    <span className={`stance-chip stance-${m.questionStance}`}>{m.questionStance}</span>
                  )}
                </span>
                {m.comparison ? (
                  <div className="compare3">
                    {m.comparison.map((v) => (
                      <div key={v.level} className={`compare3-card level-${v.level}`}>
                        <div className="compare3-head">
                          <span className="compare3-level">{`L${v.level}`}</span>
                          <span className="compare3-label">{v.label}</span>
                          {v.kind && <span className="compare3-kind">{v.kind}</span>}
                        </div>
                        <div className="compare3-text">{v.text}</div>
                        {v.options && v.options.length > 0 && (
                          <div className="compare3-options">
                            {v.options.map((option, index) => (
                              <span key={index} className="option-chip static">{option}</span>
                            ))}
                          </div>
                        )}
                        {v.rejectionReasons.length > 0 && (
                          <div className="compare3-rej">gate: {v.rejectionReasons.join("; ")}</div>
                        )}
                        <button
                          type="button"
                          className="compare3-continue"
                          disabled={loading}
                          onClick={() => void continueWithLevel(m.id, v.level, m.comparisonUserText ?? "")}
                        >
                          Continue with this →
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  // Writer content, so it goes through the engine — the
                  // interface pass only ever swaps dictionary copy.
                  <div className="msg-bubble">{translate(m.text)}</div>
                )}
                {m.role === "assistant" && m.questionAnchor && (
                  <button className="anchor-view-btn" type="button" onClick={() => revealDraftAnchor(m.questionAnchor!)}>
                    View passage
                  </button>
                )}
                {m.proposalId && proposals.has(m.proposalId) && (proposals.get(m.proposalId)!.detail.kind === "reflection" ? (
                    <MirrorCard
                      proposal={proposals.get(m.proposalId)!}
                      onDecide={(claimId, decision) => void decideClaim(m.proposalId!, claimId, decision)}
                      onEdit={(claimId, text) => editMirrorClaim(m.proposalId!, claimId, text)}
                    />
                  ) : (
                    <MapActionProposalCard
                      proposal={proposals.get(m.proposalId)!}
                      cards={mapStoreRef.current.getAll().filter((card) => card.role !== "connection_label")}
                      onEdit={updateActionProposal}
                      onDecide={decideActionProposal}
                    />
                  ))}
              </div>
            ))}
            {loading && (
              <div className="msg assistant">
                <span className="msg-label">coach</span>
                <div className="msg-bubble" style={{ color: "#aaa", fontStyle: "italic" }}>
                  thinking...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            {error && <div className="error-banner">{error}</div>}
            {stickyDraftFocus && (
              <div className="focus-chip" role="status">
                <span className="focus-chip-text">Focusing on selected text: “{focusSummary(stickyDraftFocus.text)}”</span>
                <button className="focus-chip-dismiss" type="button" onClick={() => setStickyDraftFocus(undefined)} aria-label="Stop focusing on selected text">×</button>
              </div>
            )}
            {readOnlyView && (
              // §6.3: say why typing is refused, right where the user would type.
              <div className="read-only-note" data-no-translate>
                Viewing in {languageLabel(effectiveLanguage(language))} {"·"} switch back to{" "}
                {languageLabel(language.writeLanguage)} to edit
              </div>
            )}
            <div className="input-row">
              <textarea
                ref={textareaRef}
                className={`composer-textarea ${composerScrollable ? "composer-scroll" : ""}`}
                rows={2}
                placeholder={
                  readOnlyView
                    ? `Switch back to ${languageLabel(language.writeLanguage)} to continue writing…`
                    : "Say what's on your mind…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                // A translation is not the writer's own words, so nothing may be
                // composed or sent while it is on screen.
                disabled={loading || readOnlyView}
              />
              <div className="composer-toolbar">
                <div className="composer-left-tools">
                  <button
                    className={`uth-toggle-btn ${underhoodOpen ? "active" : ""}`}
                    type="button"
                    title={underhoodOpen ? "Close Control Room" : "Open Control Room"}
                    aria-label={underhoodOpen ? "Close Control Room panel" : "Open Control Room panel"}
                    aria-pressed={underhoodOpen}
                    onClick={() => setUnderhoodOpen((value) => !value)}
                  >
                    <UnderhoodIcon />
                    <span>Control Room</span>
                  </button>
                  <button
                    className="draft-toggle-btn"
                    type="button"
                    title={draftDocked ? "Open draft" : "Dock draft"}
                    aria-label={draftDocked ? "Open draft" : "Dock draft"}
                    onClick={toggleDraftFromComposer}
                  >
                    Draft
                  </button>
                </div>
                <div className="composer-action-tools">
                  {draftSelectionFocus?.text.trim() && (
                    <button
                      className="draft-toggle-btn"
                      type="button"
                      title="Keep this selected draft text as the coach's focus until you dismiss it"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={pinDraftSelection}
                    >
                      Ask about this
                    </button>
                  )}
                  <button
                    className="draft-toggle-btn"
                    type="button"
                    title="Create a confirmable card from this wording"
                    onClick={addComposerAsCard}
                    disabled={loading || !input.trim()}
                  >
                    Add as card
                  </button>
                  <button
                    className={`mic-btn ${speech.listening ? "live" : ""}`}
                    type="button"
                    title={
                      speech.supported
                        ? speech.listening
                          ? "Stop voice dictation"
                          : "Start voice dictation"
                        : "Voice dictation is unavailable in this browser"
                    }
                    aria-label={
                      speech.supported
                        ? speech.listening
                          ? "Stop voice dictation"
                          : "Start voice dictation"
                        : "Voice dictation is unavailable in this browser"
                    }
                    aria-pressed={speech.listening}
                    disabled={!speech.supported || loading}
                    onClick={() => {
                      if (speech.listening) {
                        speech.stop();
                        return;
                      }
                      speech.start(input);
                    }}
                  >
                    <MicIcon />
                  </button>
                  <button className="send-btn" onClick={() => void send()} disabled={loading || readOnlyView || !input.trim()}>
                    {"\u2191"}
                  </button>
                </div>
              </div>
            </div>
            <div className="input-hint">
              <span>Enter to send {"\u00b7"} Shift+Enter for newline</span>
              <button type="button" className="clear-chat-btn" onClick={clearChatOnly} disabled={readOnlyView} title="Clear the chat conversation only">
                Clear chat
              </button>
            </div>
          </div>
        </div>

        {/* Draft floating layer - chip when collapsed, panel when open. Hidden
            (not unmounted) while docked so draft text, scroll, and anchors survive. */}
        <div className="draft-layer" style={{ display: draftDocked ? "none" : "contents" }}>
        {draftCollapsed ? (
          <button
            type="button"
            className="draft-chip"
            style={{ left: draftPos.x, top: draftPos.y }}
            onMouseDown={onChipMouseDown}
            title="Open draft - drag to move, click to expand"
          >
            <span className="draft-chip-label">DRAFT</span>
            {highlightAnchor && <span className="draft-chip-dot" aria-label="anchored" />}
          </button>
        ) : (
        <div
          ref={draftPanelRef}
          className="draft-panel"
          style={{
            left: draftPos.x,
            top: draftPos.y,
            width: draftSize.w,
            height: draftSize.h,
          }}
          // Clicking anywhere inside the draft dismisses the anchor highlight.
          onMouseDown={() => setHighlightAnchor(undefined)}
        >
          <div className="draft-panel-header" onMouseDown={onDragStart}>
            <span className="draft-panel-title">Draft</span>
            <button
              className="draft-panel-btn"
              type="button"
              onClick={() => setDraftDocked(true)}
              title="Dock the draft into the map toolbar"
            >
              Dock
            </button>
            <button
              className="draft-panel-btn draft-panel-btn-icon"
              type="button"
              onClick={() => {
                const back = preExpandChipPosRef.current;
                if (back) setDraftPos(clampBoxPosition(back, DRAFT_CHIP_WIDTH, DRAFT_CHIP_HEIGHT));
                setDraftCollapsed(true);
              }}
              aria-label="Collapse draft"
              title="Collapse to icon"
            >
              <span className="draft-chevron-down" aria-hidden="true" />
            </button>
          </div>

          {/* Resize handles on the panel border - outside the content area */}
          {!draftCollapsed && (
            <>
              <div className="rh rh-n"  onMouseDown={(e) => startResize(e, { top: true })} />
              <div className="rh rh-s"  onMouseDown={(e) => startResize(e, { bottom: true })} />
              <div className="rh rh-e"  onMouseDown={(e) => startResize(e, { right: true })} />
              <div className="rh rh-w"  onMouseDown={(e) => startResize(e, { left: true })} />
              <div className="rh rh-nw" onMouseDown={(e) => startResize(e, { top: true, left: true })} />
              <div className="rh rh-ne" onMouseDown={(e) => startResize(e, { top: true, right: true })} />
              <div className="rh rh-se" onMouseDown={(e) => startResize(e, { bottom: true, right: true })} />
              <div className="rh rh-sw" onMouseDown={(e) => startResize(e, { bottom: true, left: true })} />
            </>
          )}

          {!draftCollapsed && (
            <div className="draft-body">
              <div className="draft-editor-wrap">
                {readOnlyView ? (
                  // Render the translation in a separate, non-editable node.
                  // Writing it into the contentEditable above would fire
                  // onInput and overwrite the real draft with the translation.
                  <div className="draft-editor draft-editor-translated">
                    {draftText}
                  </div>
                ) : (
                  <div
                    ref={draftRef}
                    className="draft-editor"
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-multiline="true"
                    data-placeholder="Paste or type your draft here..."
                    onInput={handleDraftInput}
                    onSelect={updateDraftSelectionFocus}
                    onKeyUp={updateDraftSelectionFocus}
                    onMouseUp={updateDraftSelectionFocus}
                    onPaste={handleDraftPaste}
                  />
                )}
              </div>
            </div>
          )}
        </div>
        )}
        </div>

        <div className={`map-shell ${underhoodOpen ? "underhood-open" : ""}`}>
          <ThoughtMap
            key={mapMountKey}
            store={mapStoreRef.current}
            bank={stateRef.current.bank}
            confirmed={confirmed}
            coachDebug={lastCoachDebug}
            commandAck={commandAck}
            languageTools={
              <div className={`language-bar${readOnlyView ? " is-translated" : ""}`} data-no-translate>
                <label
                  className={`lang-field${isWriteLocked ? " is-locked" : ""}`}
                  title={isWriteLocked
                    ? "Locked: this session already has content, and content is only ever stored in one language. Clear the map and the chat to change it."
                    : "The language you write in — the whole interface renders in it. It locks once this session has content."}
                >
                  <span className="lang-field-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10z" />
                      <path d="M10 4l2 2" />
                    </svg>
                  </span>
                  <select
                    aria-label="Writing language"
                    value={language.writeLanguage}
                    // Greyed rather than silently inert, so a click reads as
                    // "locked for a reason" instead of a broken control.
                    disabled={isWriteLocked}
                    onChange={(event) =>
                      setLanguage((current) => setWriteLanguage(current, event.target.value))
                    }
                  >
                    {LANGUAGE_PICKER_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>{optionText(option)}</option>
                    ))}
                  </select>
                </label>
                <span className="lang-divider" aria-hidden="true" />
                <label className="lang-field lang-field-view" title="Show a read-only translation for a teacher or reader who does not read your writing language. Nothing you see here is written back.">
                  <span className="lang-field-icon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1.5 8S3.5 4 8 4s6.5 4 6.5 4-2 4-6.5 4S1.5 8 1.5 8z" />
                      <circle cx="8" cy="8" r="1.8" />
                    </svg>
                  </span>
                  <select
                    aria-label="Translation language"
                    value={effectiveLanguage(language)}
                    onChange={(event) =>
                      setLanguage((current) => selectViewLanguage(current, event.target.value))
                    }
                  >
                    {LANGUAGE_PICKER_OPTIONS.map((option) => (
                      <option key={option.code} value={option.code}>{optionText(option)}</option>
                    ))}
                  </select>
                </label>
              </div>
            }
            draftDockSlot={
              <div className={`map-draft-slot ${draftDocked ? "occupied" : "empty"}`}>
                {draftDocked ? (
                <button
                  type="button"
                  className="map-draft-dock"
                  onMouseDown={onDockedDraftMouseDown}
                  title="Click to open draft, or drag out to undock"
                >
                  <span className="map-draft-dock-label">DRAFT</span>
                  {highlightAnchor && <span className="map-draft-dock-dot" aria-hidden="true" />}
                </button>
                ) : (
                  <span className="map-draft-slot-label">Draft</span>
                )}
              </div>
            }
            draftDockActive={draftDockTargetActive}
            highlightedCardIds={referencedCardIds}
            contextSelectedCardIds={contextSelectedCardIds}
            revision={mapRevision}
            requireConnectionLabel={requireConnectionLabel}
            onRequireConnectionLabelChange={setRequireConnectionLabel}
            canUndo={canUndoMap}
            onUndo={undoMapChange}
            onClearDraft={clearDraftOnly}
            onClearMap={clearMapOnly}
            onContextCardToggle={toggleContextCard}
            onClearContextSelection={clearContextSelection}
            onBeforeMapChange={captureMapUndo}
            onStoreChange={markUserMapChanged}
          />
          <UnderTheHoodPanel
            snapshot={understandingSnapshot}
            recap={recapData}
            onSegmentThinking={segmentThinking}
            onDraftAnchor={revealDraftAnchor}
            onRequestMode={requestMode}
            onDismissIdea={dismissTrackedIdea}
            busy={loading}
            open={underhoodOpen}
            onOpenChange={setUnderhoodOpen}
          />
        </div>
      </div>
    </TranslationContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Mirror confirmation card
// ---------------------------------------------------------------------------

/**
 * Heads-up badge shown when a proposal's wording echoes the coach's own prior
 * message. Keeps L0's "your words" claim honest in the moment: the percentage
 * is the share of the proposal's cited phrases that came back verbatim from the
 * coach, and the tooltip lists them.
 */
export function InfluenceBadge({ influence }: { influence?: import("./assistance-contract").InfluenceTrace }) {
  if (!influence || !influence.exactOverlapPhrases.length) return null;
  const pct = Number.isFinite(influence.overlapRatio) ? Math.round(influence.overlapRatio! * 100) : undefined;
  return (
    <span
      className="influence-badge"
      title={`This wording echoes your coach's previous message: "${influence.exactOverlapPhrases.join('", "')}"`}
    >
      Echoes coach{pct === undefined ? "" : ` · ${pct}%`}
    </span>
  );
}

export function AssistantResponseKindBadge({ kind }: { kind?: AssistantResponse["kind"] }) {
  if (kind !== "suggestion") return null;
  return <span className="ai-suggestion-badge">AI suggestion</span>;
}

export function MirrorCard({
  proposal,
  onDecide,
  onEdit,
}: {
  proposal: Proposal;
  onDecide: (claimId: string, decision: "confirmed" | "declined") => void;
  onEdit: (claimId: string, text: string) => void;
}) {
  if (proposal.detail.kind !== "reflection") return null;
  if (proposal.state === "invalidated") return <div className="mirror-card"><span className="mirror-card-label">This proposal is no longer valid: {proposal.invalidReason}</span></div>;
  if (proposal.state === "confirmed" || proposal.state === "declined" || proposal.state === "cancelled") return null;
  const reflection = proposal.detail;
  return (
    <div className="mirror-card">
      <div className="mirror-card-head">
        <span className="mirror-card-label">Here&apos;s the structure in your words — edit if needed, then confirm</span>
        <InfluenceBadge influence={proposal.influenceTrace} />
      </div>
      <div className="mirror-claims">
        {reflection.reflection.claims.map((claim, index) => {
          const decision = reflection.decisions[claim.id] ?? "pending";
          const text = reflection.editedTexts[claim.id] ?? claim.text;
          const claimNumber = index + 1;
          return (
            <div key={claim.id} className="claim-row">
              {decision === "pending" ? (
                <textarea
                  className="claim-text claim-editor"
                  value={text}
                  rows={Math.max(5, Math.min(10, text.split(/\n/).length + Math.ceil(text.length / 42)))}
                  onChange={(event) => onEdit(claim.id, event.target.value)}
                  aria-label={`Editable mirrored wording ${claimNumber}`}
                />
              ) : (
                <span className="claim-text">{text}</span>
              )}
              {decision === "pending" ? (
                <div className="claim-btns">
                  <button
                    className="btn btn-confirm-sm"
                    disabled={!text.trim()}
                    onClick={() => onDecide(claim.id, "confirmed")}
                    aria-label={`Confirm mirrored wording ${claimNumber}`}
                  >
                    Yes
                  </button>
                  <button
                    className="btn btn-decline-sm"
                    onClick={() => onDecide(claim.id, "declined")}
                    aria-label={`Reject mirrored wording ${claimNumber}`}
                  >
                    Not quite
                  </button>
                </div>
              ) : (
                <span className={`claim-badge ${decision}`}>
                  {decision === "confirmed" ? " confirmed" : " not quite"}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function migrateStoredProposals(items: Proposal[], bank: ConversationState["bank"], store: ThoughtUnitStore): Proposal[] {
  const contract = snapshotContract(DEFAULT_ASSISTANCE_CONTRACT);
  return items.map((proposal) => {
    const normalized = { ...proposal, influenceTrace: normalizeInfluenceTrace(proposal.influenceTrace) };
    if ((normalized.state === "shown" || normalized.state === "edited") && normalized.detail.kind === "map_action") {
      const mapDetail = normalized.detail;
      if (mapDetail.action.kind === "connect_cards" && !mapDetail.action.labelText?.trim() && !mapDetail.pairingProof && !(mapDetail.completion?.kind === "relationship_label" && mapDetail.completion.pairingProof)) {
        return { ...normalized, state: "invalidated", invalidReason: "This earlier connection proposal lacks durable pairing evidence." };
      }
    }
    if (normalized.contract && normalized.origin) {
      if ((normalized.state === "shown" || normalized.state === "edited") && normalized.origin === "unresolved") {
        return { ...normalized, state: "invalidated", invalidReason: normalized.invalidReason ?? "This earlier-version proposal needs to be created again." };
      }
      return normalized;
    }
    if (normalized.state !== "shown" && normalized.state !== "edited") {
      return { ...normalized, origin: "legacy_confirmed", contract };
    }
    if (normalized.attribution !== "asserted") {
      return { ...normalized, origin: "unresolved", contract, state: "invalidated", invalidReason: normalized.invalidReason ?? "This earlier-version proposal needs to be created again." };
    }
    if (normalized.detail.kind === "reflection") {
      const valid = validateMirror(normalized.detail.reflection, bank.getAll(), defaultConfig).ok;
      return valid
        ? { ...normalized, origin: "user_asserted", contract }
        : { ...normalized, origin: "unresolved", contract, state: "invalidated", invalidReason: "This earlier reflection no longer validates." };
    }
    const check = inspectAction(normalized.detail.action, { actor: "ai_proposal", store, bank, requireConnectionLabel: true, allowAiSuggestedStructure: false });
    return check.status !== "ready"
      ? { ...normalized, origin: "unresolved", contract, state: "invalidated", invalidReason: check.detail }
      : { ...normalized, origin: check.origin ?? "user_asserted", contract };
  });
}

export function MapActionProposalCard({
  proposal,
  cards,
  onEdit,
  onDecide,
}: {
  proposal: Proposal;
  cards: ThoughtUnit[];
  onEdit: (id: string, action: ProposedAction) => void;
  onDecide: (id: string, decision: "confirmed" | "declined") => void;
}) {
  if (proposal.detail.kind !== "map_action") return null;
  const { action } = proposal.detail;
  const completion = proposal.detail.completion;
  if (proposal.state === "confirmed" || proposal.state === "declined" || proposal.state === "cancelled") return null;
  if (proposal.state === "invalidated") {
    return <div className="mirror-card"><span className="mirror-card-label">This proposal is no longer valid: {proposal.invalidReason}</span></div>;
  }
  const visibleCards = completion?.kind === "reference_choice"
    ? cards.filter((card) => completion.candidates.some((candidate) => candidate.id === card.id))
    : cards;
  const cardOptions = (
    <option value="">Choose an existing card…</option>
  );
  const selectRef = (
    value: string | undefined,
    onChange: (id: string) => void,
    label: string,
  ) => (
    <label className="claim-row">
      <span className="claim-text">{label}</span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        {cardOptions}
        {visibleCards.map((card) => <option key={card.id} value={card.id}>{card.text || "Untitled card"}</option>)}
      </select>
    </label>
  );
  const renderEditor = () => {
    if (action.kind === "create_card") {
      return <textarea className="claim-text claim-editor" value={action.text} rows={3} onChange={(event) => onEdit(proposal.id, { ...action, text: event.target.value })} />;
    }
    if (action.kind === "edit_card") {
      return <textarea className="claim-text claim-editor" value={action.text} rows={3} onChange={(event) => onEdit(proposal.id, { ...action, text: event.target.value })} />;
    }
    if (action.kind === "nest_card") {
      return <>
        {selectRef(action.child.id, (id) => onEdit(proposal.id, { ...action, child: { id } }), "Card to place")}
        {selectRef(action.parent.id, (id) => onEdit(proposal.id, { ...action, parent: { id } }), "Parent card")}
      </>;
    }
    return <>
      {selectRef(action.source.id, (id) => onEdit(proposal.id, { ...action, source: { id } }), "From")}
      {selectRef(action.target.id, (id) => onEdit(proposal.id, { ...action, target: { id } }), "To")}
      <textarea className="claim-text claim-editor" value={action.labelText ?? ""} placeholder="Relationship wording" rows={2} onChange={(event) => onEdit(proposal.id, { ...action, labelText: event.target.value, labelOrigin: action.labelOrigin === "ai_suggested" ? "ai_suggested" : "user_asserted" })} />
      {completion?.kind === "relationship_label" && completion.options.length > 0 && (
        <div className="claim-btns">
          {completion.options.map((option, index) => <button key={`${option.text}-${index}`} className="btn btn-decline-sm" onClick={() => onEdit(proposal.id, { ...action, labelText: option.text, labelSourceUtteranceIds: option.sourceUtteranceIds, labelOrigin: option.origin })}>{option.origin === "ai_suggested" ? `AI suggestion: ${option.text}` : option.text}</button>)}
        </div>
      )}
    </>;
  };
  const complete = action.kind === "create_card" || action.kind === "edit_card"
    ? Boolean(action.text.trim())
    : action.kind === "nest_card"
      ? Boolean(action.child.id && action.parent.id)
      : Boolean(action.source.id && action.target.id && (completion?.kind !== "relationship_label" || action.labelText?.trim()));
  return (
    <div className="mirror-card">
      <div className="mirror-card-head">
        <span className="mirror-card-label">{proposal.origin === "ai_suggested" ? "AI suggestion — review before adding" : "Review this map change"}</span>
        <InfluenceBadge influence={proposal.influenceTrace} />
      </div>
      {renderEditor()}
      <div className="claim-btns">
        <button className="btn btn-confirm-sm" disabled={!complete} onClick={() => onDecide(proposal.id, "confirmed")}>Confirm</button>
        <button className="btn btn-decline-sm" onClick={() => onDecide(proposal.id, "declined")}>Dismiss</button>
      </div>
    </div>
  );
}
