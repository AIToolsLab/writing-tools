import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { makeLLM, type ConversationMessage } from "./api";
import { defaultConfig, withQuestionIntentBias, type MindmapConfig } from "./config";
import {
  createState,
  processTurn,
  type AcceptedMapCommand,
  type ControllerMode,
  type PendingMapCommand,
  type SuppressionReason,
  type TurnOutput,
} from "./controller";
import type { LoopState } from "./controller";
import { detectDraftDeclarations } from "./draft-declarations";
import type { MockLLM, QuestionStance, SelectedFocusContext, UserRequestedMode } from "./llm-contract";
import { pruneContextSelection, ThoughtMap, toggleContextSelection, type CoachDebugInfo, type MapCommandAcknowledgement } from "./Map";
import { applyAcceptedMapCommands } from "./map-commands";
import { ThoughtUnitStore, type ThoughtUnitStoreSnapshot } from "./map-store";
import { promoteOpenThreadsForUtterances, reopenPromotedOpenThreads, type ParkedThread } from "./open-threads";
import { evaluateReadiness } from "./readiness";
import { cardRef } from "./store";
import type { SourceSpan, SourceUtterance, ThoughtUnitRole } from "./types";
import type { ClaimValidation, ConfirmedReflection, MirrorReflection } from "./types";
import { buildUnderstanding, type SafetyCheck, type TrackedIdea, type UnderhoodEvent, type UnderstandingSnapshot } from "./understanding";
import { useSpeechToText } from "./useSpeechToText";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  text: string;
  mode?: "question" | "mirror" | "clarify";
  /** Set when this message carries a mirror the user hasn't acted on yet. */
  mirrorId?: string;
  /** Verbatim draft substring this question is anchored to, if any. */
  questionAnchor?: string;
  /** The coaching stance the AI chose for this turn, if any. */
  questionStance?: QuestionStance;
}

interface DraftPanelPos { x: number; y: number; }
interface DraftPanelSize { w: number; h: number; }

interface MapUndoSnapshot {
  map: ThoughtUnitStoreSnapshot;
  bank: ReturnType<LoopState["bank"]["getAll"]>;
  openThreads: ParkedThread[];
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

interface PendingMirror {
  id: string;
  reflection: MirrorReflection;
  claims: ClaimValidation[];
  decisions: Record<string, ClaimDecision>;
  editedTexts: Record<string, string>;
}

interface PersistedPendingMirror {
  id: string;
  reflection: MirrorReflection;
  claims: ClaimValidation[];
  decisions: Record<string, ClaimDecision>;
  editedTexts?: Record<string, string>;
}

interface PersistedSession {
  version: 1;
  msgs: ChatMsg[];
  pendingMirrors: PersistedPendingMirror[];
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
  controller: {
    mode: ControllerMode;
    turnsSinceLastMirror: number;
    clarifyTarget?: SourceSpan;
    lastAiText: string;
    prevAiText?: LoopState["prevAiText"];
    coverageFocus?: LoopState["coverageFocus"];
    draft: string;
    pendingMapCommand?: PendingMapCommand;
    organizeFocus?: LoopState["organizeFocus"];
    pendingChildPlacement?: LoopState["pendingChildPlacement"];
    activeElicitation?: LoopState["activeElicitation"];
    activeSelectionContext?: LoopState["activeSelectionContext"];
    openThreads?: LoopState["openThreads"];
    dismissedCandidateIds?: LoopState["dismissedCandidateIds"];
    pendingCardWording?: LoopState["pendingCardWording"];
    captureLoop?: LoopState["captureLoop"];
    lastCoachQuestion?: LoopState["lastCoachQuestion"];
  };
  bank: LoopState["bank"] extends { getAll(): infer T } ? T : never;
  candidates: LoopState["candidates"] extends { getAll(): infer T } ? T : never;
  map: ThoughtUnitStoreSnapshot;
}

interface DraftSelectionFocus { text: string; }

function commandAckText(commands: AcceptedMapCommand[]): string {
  if (commands.length !== 1) return `${commands.length} map changes applied.`;
  const command = commands[0];
  if (command.kind === "create_card") return `Card added: "${command.text}".`;
  if (command.kind === "edit_card") return `Card updated: "${command.text}".`;
  if (command.kind === "nest_card") return "Card nested.";
  return command.labelText ? "Cards connected with your label." : "Cards connected.";
}

function commandSourceUtteranceIds(commands: AcceptedMapCommand[]): string[] {
  const ids = new Set<string>();
  for (const command of commands) {
    if (command.kind === "create_card") {
      command.sourceUtteranceIds.forEach((id) => ids.add(id));
    } else if (command.kind === "edit_card") {
      command.sourceUtteranceIds.forEach((id) => ids.add(id));
    } else if (command.kind === "nest_card") {
      if ("sourceUtteranceIds" in command.child) {
        command.child.sourceUtteranceIds.forEach((id) => ids.add(id));
      }
    } else {
      if ("sourceUtteranceIds" in command.source) {
        command.source.sourceUtteranceIds.forEach((id) => ids.add(id));
      }
      if ("sourceUtteranceIds" in command.target) {
        command.target.sourceUtteranceIds.forEach((id) => ids.add(id));
      }
      command.labelSourceUtteranceIds?.forEach((id) => ids.add(id));
    }
  }
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// Styles (no build step needed, just a style tag approach via CSS-in-JS)
// ---------------------------------------------------------------------------

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f5f4f0;
    color: #1a1a1a;
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
    border-right: 1px solid #e5e3de;
    height: 100vh;
  }

  .chat-header {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 60px;
    padding: 10px 16px;
    border-bottom: 1px solid #e5e3de;
    background: #fafaf8;
    flex-shrink: 0;
  }

  .chat-header-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .chat-header-actions-left {
    flex: 0 0 auto;
  }

  .reset-btn {
    font-size: 11px;
    font-weight: 600;
    padding: 4px 10px;
    border-radius: 6px;
    border: 1px solid #ddd;
    background: #f0efeb;
    color: #666;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .reset-btn:hover { opacity: 0.7; }

  .stance-chip {
    margin-left: 6px;
    font-size: 9px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 99px;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    background: #efece6;
    color: #8a857c;
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
    background: #f0efeb;
    color: #1a1a1a;
    border-bottom-left-radius: 4px;
  }
  .msg.assistant.mirror .msg-bubble  { background: #e8f8ed; }
  .msg.assistant.clarify .msg-bubble { background: #fff3e0; }

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
    background: #f0efeb;
    color: #555;
    transition: opacity 0.15s;
  }
  .btn-decline-sm:hover { opacity: 0.85; }

  /* ---- input area ---- */
  .input-area {
    border-top: 1px solid #e5e3de;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: #fafaf8;
    flex-shrink: 0;
  }

  .input-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    border: 1px solid #d8d3c8;
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
    color: #77736c;
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
    font-size: 11px;
    color: #aaa;
    line-height: 1.3;
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
    border-bottom: 1px solid #e5e3de;
    background: #fafaf8;
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
    color: #8a8780;
  }

  .map-left-tools,
  .map-right-tools {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 7px;
    flex-wrap: nowrap;
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

  .question-bias {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: auto minmax(82px, 118px) auto;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    font-weight: 600;
    color: #666;
  }

  .question-bias input {
    accent-color: #1a6fa3;
    width: 100%;
  }
  /* Native tick marks for the five snap positions. */
  .question-bias datalist {
    display: none;
  }
  .chat-question-bias {
    margin-left: auto;
    min-width: 178px;
    justify-content: end;
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
    background: #fbf7ec;
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

  @media (max-width: 1180px) {
    .question-bias {
      grid-template-columns: auto minmax(64px, 96px) auto;
    }
  }

  @media (max-width: 900px) {
    .question-bias {
      margin-left: 0;
    }
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
    border: 1px solid #d8d5ce;
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
    border: 1px solid #e2ded5;
    border-radius: 5px;
    background: #fafaf8;
    color: #8a8578;
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
    background: #fafaf8;
    border-bottom: 1px solid #e9e6df;
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
    color: #a9a49a;
    background-image: radial-gradient(currentColor 1.1px, transparent 1.4px);
    background-size: 5px 5px;
    background-position: 0 0;
  }
  .map-card-drag:hover .map-drag-grip { color: #7d7970; }

  .map-role-chip,
  .map-parent-chip {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #68645d;
  }

  .map-parent-chip {
    min-width: 0;
    max-width: 150px;
    padding-left: 6px;
    border-left: 1px solid #d8d5ce;
    color: #918d85;
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
    background: #fcfbf8;
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
    border: 1px solid #d8d5ce;
    border-radius: 6px;
    background: #fff;
    color: #4f4b45;
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
    border: 1px solid #d8d5ce;
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
    color: #68645d;
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

  .connection-affirm {
    font-size: 12px;
    font-weight: 700;
    color: #4f4b45;
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
    border: 1px solid #c9c5bd;
    background: #fff;
    color: #6a665f;
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .edge-badge:hover { background: #f3f1ec; }
  .edge-badge.active {
    background: #1a1a1a;
    color: #fff;
    border-color: #1a1a1a;
    box-shadow: 0 0 0 3px rgba(26,26,26,0.18);
  }
  .edge-move-hint {
    font-size: 11px;
    color: #b9b6ad;
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
    color: #b9b6ad;
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
    border: 1px solid #4a4945;
    border-radius: 6px;
    background: #2b2b2b;
    color: #f5f2ea;
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
    padding: 5px 8px;
    text-align: left;
  }
  .edge-direction-buttons button:hover { background: #363636; }
  .edge-direction-buttons button.active {
    background: #f5f2ea;
    color: #1f1e1b;
    border-color: #f5f2ea;
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
    background: #1a1a1a;
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
    color: #e7e4dc;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .edge-popover-card b { color: #f0b429; margin-right: 4px; }
  .edge-popover-text {
    font-style: italic;
    color: #d9d6ce;
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
    border: 1px solid #d8d5ce;
    background: #fff;
    color: #5f5b54;
    cursor: pointer;
  }
  .map-label-toggle.active {
    border-color: #b5dfc5;
    background: #eafaf0;
    color: #1a7a3c;
  }
  .map-label-toggle:hover { background: #f3f1ec; }
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
    color: #9a958c;
    padding: 4px 16px 0;
    line-height: 1.4;
  }

  /* ---- nested (embedded) cards ---- */
  /* A card with children grows to fit them (height:auto in JS), so it must not
     clip its content the way a fixed-size childless card does. */
  .map-card.has-children {
    background: #f6f4ef;
    border-color: #cfc9be;
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
    border-top: 1px solid #ded8cc;
    border-left: 2px solid #ded8cc;
    margin-left: 8px;
    background: #fbfaf7;
  }
  .map-embed {
    position: relative;
    border: 1px solid #ded8cc;
    border-left: 3px solid #9e9586;
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
    color: #a9a49a;
    background-image: radial-gradient(currentColor 1.1px, transparent 1.4px);
    background-size: 5px 5px;
    background-position: 0 0;
    cursor: grab;
  }
  .map-embed:hover .map-embed-drag-grip { color: #7d7970; }
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
    color: #1a1a1a;
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
    color: #918d85;
  }
  .map-embed-actions button {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 5px;
    border: 1px solid #d8d5ce;
    background: #f3f1ec;
    color: #6a665f;
    cursor: pointer;
  }
  .map-embed-actions button:hover { background: #e8e5dd; }
  .map-embed-children {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 7px;
    padding-left: 22px;
    border-left: 2px solid #ded8cc;
  }
  .map-embed-children .map-embed {
    background: #fbfaf7;
  }
  /* Deepen the indent and dim the rail per nesting level so depth reads clearly. */
  .map-embed-children .map-embed-children {
    padding-left: 24px;
    border-left-color: #e4dfd4;
  }
  .map-embed-children .map-embed-children .map-embed-children {
    border-left-color: #ebe7de;
  }
  .connection-panel button:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .connection-panel button.connection-cancel {
    background: transparent;
    color: #8a857d;
  }

  .connection-wording {
    font-size: 13px;
    line-height: 1.4;
    color: #222;
    background: #fafaf8;
    border-radius: 6px;
    padding: 8px;
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
    border: 1px solid #d0cec9;
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
    background: #fafaf8;
    border-bottom: 1px solid #e5e3de;
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
    border: 1px solid #d8d4cb;
    cursor: pointer;
    font-size: 12px;
    color: #5f5a51;
    padding: 5px 9px;
    border-radius: 6px;
    line-height: 1;
    box-shadow: 0 1px 2px rgba(0,0,0,0.04);
  }
  .draft-panel-btn:hover { color: #2f2b25; background: #f2eee7; border-color: #c9bfae; }
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
    color: #1a1a1a;
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

  .draft-placeholder {
    color: #bbb;
    font-style: italic;
    pointer-events: none;
  }

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
    border: 1px solid #d9d5cc;
    border-right: none;
    border-radius: 0 8px 8px 0;
    background: #fbfaf7;
    color: #55514a;
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
    border: 1px solid #d8d4ca;
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
    border-bottom: 1px solid #e7e2d8;
    background: linear-gradient(135deg, #fffdf6, #f5fbff);
  }
  .underhood-title {
    flex: 1;
    min-width: 0;
  }
  .underhood-title strong {
    display: block;
    font-size: 13px;
    color: #24221e;
  }
  .underhood-title span {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    line-height: 1.35;
    color: #6f6a61;
  }
  .underhood-close {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border: 1px solid #d8d4ca;
    border-radius: 7px;
    background: #fff;
    color: #645f57;
    font-size: 17px;
    cursor: pointer;
  }

  .underhood-nextmove {
    flex-shrink: 0;
    padding: 8px 10px 10px;
    border-bottom: 1px solid #e7e2d8;
    background: #fbfaf6;
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
    border: 1px solid #d8d4ca;
    border-left-width: 3px;
    border-radius: 7px;
    background: #fff;
    font-size: 11.5px;
    font-weight: 600;
    line-height: 1.2;
    color: #33302a;
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

  .underhood-empty {
    margin: auto;
    max-width: 260px;
    text-align: center;
    color: #777169;
    font-size: 13px;
    line-height: 1.45;
  }

  .underhood-section {
    border: 1px solid #e5e1d8;
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
    color: #726c63;
    background: #f7f5ef;
    border-bottom: 1px solid #ece8df;
    cursor: pointer;
    text-align: left;
  }
  .underhood-section-title:hover {
    background: #f2efe7;
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
    color: #8a857b;
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
    color: #928c83;
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
    background: #6d6a62;
  }
  .underhood-orb.notice { background: #2d7fb0; }
  .underhood-orb.quiet { background: #8f8a80; }
  .underhood-orb.held { background: #b37a18; }
  .underhood-latest-text strong {
    display: block;
    font-size: 12px;
    color: #2b2924;
  }
  .underhood-latest-text span {
    display: block;
    margin-top: 2px;
    font-size: 12px;
    line-height: 1.28;
    color: #706b62;
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
    color: #5f5a52;
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
    background: #ded9cf;
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
  .event-row.stage-checked { color: #6d6a62; }
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
    color: #766f64;
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .event-title {
    display: block;
    font-size: 12px;
    font-weight: 800;
    color: #2f2c27;
  }
  .event-detail {
    display: block;
    margin-top: 3px;
    font-size: 11px;
    line-height: 1.35;
    color: #6d675f;
  }
  .event-evidence {
    display: inline-block;
    max-width: 100%;
    margin-top: 6px;
    padding: 3px 6px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.72);
    border: 1px solid rgba(85, 78, 65, 0.14);
    color: #3f3a32;
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
    color: #595247;
    font-size: 10px;
    font-weight: 800;
    padding: 3px 6px;
    cursor: pointer;
  }
  .event-detail-toggle:hover { background: #fff; border-color: #cfc8b9; }
  .event-technical {
    margin-top: 6px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .event-technical span {
    border-radius: 5px;
    background: #f1eee7;
    color: #5f5a52;
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
    border: 1px solid #ebe6dc;
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
    color: #25231f;
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
    background: #eeeae1;
    color: #655f55;
  }
  .idea-status.ready { background: #dff3e7; color: #1e7b46; }
  .idea-status.needs_your_wording { background: #fcebd1; color: #9a6810; }
  .idea-status.needs_relationship { background: #e5f0fb; color: #286fa4; }
  .idea-status.too_early { background: #eeeae1; color: #655f55; }
  .idea-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .idea-dismiss {
    border: 1px solid #e0d8c8;
    background: #fbfaf7;
    color: #6a6256;
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
    color: #716b61;
  }
  .meter-track {
    height: 7px;
    border-radius: 99px;
    background: #ebe7dd;
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
    color: #514d46;
  }
  .safety-mark {
    width: 16px;
    height: 16px;
    border-radius: 5px;
    background: #e8e4dc;
  }
  .safety-row.ok .safety-mark { background: #98d6ad; }
  .safety-row.info .safety-mark { background: #a8d0ee; }
  .safety-row.held .safety-mark { background: #e7bf73; }
  .safety-state {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #7b746a;
  }

  .anchor-button {
    width: 100%;
    border: 1px solid #e3ded4;
    border-radius: 8px;
    background: #fbfaf7;
    padding: 8px;
    text-align: left;
    color: #302d28;
    cursor: pointer;
  }
  .anchor-button:hover { background: #fff5d5; border-color: #e1be65; }
  .anchor-button.parked-thread { cursor: default; }
  .anchor-button.parked-thread:hover { background: #fbfaf7; border-color: #e3ded4; }
  .anchor-kind {
    display: block;
    margin-top: 4px;
    color: #877f72;
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
    return parsed.version === 1 ? parsed : null;
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

function cloneLoopState(state: LoopState): LoopState {
  const cloned = createState();
  cloned.bank.replaceAll(state.bank.getAll());
  cloned.candidates.replaceAll(state.candidates.getAll());
  cloned.mode = state.mode;
  cloned.turnsSinceLastMirror = state.turnsSinceLastMirror;
  cloned.clarifyTarget = state.clarifyTarget;
  cloned.lastAiText = state.lastAiText;
  // prevAiText and coverageFocus are stateful across turns: the anti-repeat
  // 2-cycle guard reads prevAiText, and a live card-coverage concern must
  // survive the working-state clone or the browser falls back to generic
  // settle/focus wording on a follow-up "not sure".
  cloned.prevAiText = state.prevAiText;
  cloned.coverageFocus = state.coverageFocus;
  cloned.draft = state.draft;
  cloned.pendingMapCommand = state.pendingMapCommand;
  cloned.organizeFocus = state.organizeFocus;
  cloned.pendingChildPlacement = state.pendingChildPlacement;
  cloned.activeElicitation = state.activeElicitation;
  cloned.activeSelectionContext = state.activeSelectionContext;
  cloned.openThreads = state.openThreads;
  cloned.dismissedCandidateIds = state.dismissedCandidateIds;
  cloned.pendingCardWording = state.pendingCardWording;
  cloned.captureLoop = state.captureLoop;
  // Answer-detection (Goal 5) reads the coach's last question across turns, so it
  // must survive the working-state clone or the transition guard never sees it.
  cloned.lastCoachQuestion = state.lastCoachQuestion;
  return cloned;
}

function mergeLiveBankIntoWorkingState(workingState: LoopState, liveState: LoopState) {
  const mergedById = new Map<string, SourceUtterance>();
  for (const unit of workingState.bank.getAll()) {
    mergedById.set(unit.id, unit);
  }
  for (const liveUnit of liveState.bank.getAll()) {
    const current = mergedById.get(liveUnit.id);
    if (current) {
      mergedById.set(liveUnit.id, {
        ...current,
        commandOnly: Boolean(current.commandOnly || liveUnit.commandOnly),
        nonHarvestable: Boolean(current.nonHarvestable || liveUnit.nonHarvestable),
      });
    } else {
      mergedById.set(liveUnit.id, liveUnit);
    }
  }
  workingState.bank.replaceAll(Array.from(mergedById.values()));
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

function eventStageMark(stage: UnderhoodEvent["stage"]): string {
  return {
    noticed: "1",
    tracked: "2",
    checked: "3",
    held: "!",
    chosen: ">",
  }[stage];
}

function eventStage(event: UnderhoodEvent): UnderhoodEvent["stage"] {
  const stage = event.stage as UnderhoodEvent["stage"] | undefined;
  if (stage) return stage;
  if (event.state === "held") return "held";
  if (event.state === "chosen") return "chosen";
  if (event.state === "passed") return "checked";
  return "noticed";
}

function underhoodTabLabel(snapshot: UnderstandingSnapshot | null): string {
  if (!snapshot) return "Under the hood";
  return snapshot.activeEvents[0]?.title ?? snapshot.latest.title ?? "Under the hood";
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
  { mode: "mirror", label: "Reflect this back", hint: "Sum up what I've said so far" },
  { mode: "deepen", label: "Go deeper", hint: "Dig into the idea on the table" },
  { mode: "organize", label: "Connect the ideas", hint: "Ask how my thoughts relate" },
  { mode: "pivot", label: "Ask something else", hint: "This question isn't landing - move on" },
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
  onDraftAnchor,
  onRequestMode,
  onDismissIdea,
  busy = false,
  open: controlledOpen,
  onOpenChange,
}: {
  snapshot: UnderstandingSnapshot | null;
  onDraftAnchor: (anchor: string) => void;
  onRequestMode?: (mode: UserRequestedMode) => void;
  onDismissIdea?: (ideaId: string) => void;
  busy?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
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
        aria-label="Open under the hood panel"
      >
        {underhoodTabLabel(snapshot)}
      </button>
    );
  }

  return (
    <aside className="underhood-panel" aria-label="Under the hood">
      <div className="underhood-head">
        <div className="underhood-title">
          <strong>Under the hood</strong>
          <span>{snapshot?.banner ?? "This will show what the coach is considering as we talk."}</span>
        </div>
        <button
          type="button"
          className="underhood-close"
          onClick={() => setOpen(false)}
          aria-label="Close under the hood panel"
        >
          x
        </button>
      </div>

      {onRequestMode && (
        <UnderhoodSection
          title="What do you want next?"
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
    </aside>
  );
}

export default function App() {
  const persistedSession = useMemo(() => loadPersistedSession(), []);

  const initialState = useMemo(() => {
    const state = createState();
    if (!persistedSession) return state;
    state.bank.replaceAll(persistedSession.bank);
    state.candidates.replaceAll(persistedSession.candidates);
    state.mode = persistedSession.controller.mode;
    state.turnsSinceLastMirror = persistedSession.controller.turnsSinceLastMirror;
    state.clarifyTarget = persistedSession.controller.clarifyTarget;
    state.lastAiText = persistedSession.controller.lastAiText;
    state.prevAiText = persistedSession.controller.prevAiText;
    state.coverageFocus = persistedSession.controller.coverageFocus;
    state.draft = persistedSession.controller.draft;
    state.pendingMapCommand = persistedSession.controller.pendingMapCommand;
    state.organizeFocus = persistedSession.controller.organizeFocus;
    state.pendingChildPlacement = persistedSession.controller.pendingChildPlacement;
    state.activeElicitation = persistedSession.controller.activeElicitation;
    state.activeSelectionContext = persistedSession.controller.activeSelectionContext;
    state.openThreads = persistedSession.controller.openThreads ?? [];
    state.dismissedCandidateIds = persistedSession.controller.dismissedCandidateIds ?? [];
    state.pendingCardWording = persistedSession.controller.pendingCardWording;
    state.captureLoop = persistedSession.controller.captureLoop;
    state.lastCoachQuestion = persistedSession.controller.lastCoachQuestion;
    return state;
  }, [persistedSession]);

  const initialMapStore = useMemo(() => {
    const store = new ThoughtUnitStore();
    if (persistedSession) {
      store.loadSnapshot(persistedSession.map);
    }
    return store;
  }, [persistedSession]);

  const initialMsgs = persistedSession?.msgs ?? [];
  const initialPendingMirrors = useMemo(
    () =>
      new Map(
        (persistedSession?.pendingMirrors ?? []).map((pm) => [
          pm.id,
          { ...pm, editedTexts: pm.editedTexts ?? {} },
        ]),
      ),
    [persistedSession],
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

  const stateRef = useRef<LoopState>(initialState);
  const configRef = useRef<MindmapConfig>(withQuestionIntentBias(defaultConfig, initialQuestionBias));
  const llmRef = useRef<MockLLM>(makeLLM(() => configRef.current, buildConversationHistory(initialMsgs)));
  const mapStoreRef = useRef<ThoughtUnitStore>(initialMapStore);
  const undoStackRef = useRef<MapUndoSnapshot[]>([]);

  const [msgs, setMsgs] = useState<ChatMsg[]>(initialMsgs);
  const [pendingMirrors, setPendingMirrors] = useState<Map<string, PendingMirror>>(initialPendingMirrors);
  const [confirmed, setConfirmed] = useState<ConfirmedReflection[]>(initialConfirmed);
  const [lastCoachDebug, setLastCoachDebug] = useState<CoachDebugInfo | null>(initialCoachDebug);
  const [understandingSnapshot, setUnderstandingSnapshot] = useState<UnderstandingSnapshot | null>(initialUnderstandingSnapshot);
  const [mapRevision, setMapRevision] = useState(initialMapRevision);
  const [mapMountKey, setMapMountKey] = useState(0);
  const [questionBias, setQuestionBias] = useState(initialQuestionBias);
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

  const runtimeConfig = useMemo(
    () => withQuestionIntentBias(defaultConfig, questionBias),
    [questionBias],
  );

  useEffect(() => {
    configRef.current = runtimeConfig;
  }, [runtimeConfig]);

  useEffect(() => {
    llmRef.current = makeLLM(() => configRef.current, buildConversationHistory(msgs));
  }, [msgs]);

  const captureMapUndo = useCallback(() => {
    undoStackRef.current.push({
      map: mapStoreRef.current.snapshot(),
      bank: stateRef.current.bank.getAll(),
      openThreads: stateRef.current.openThreads,
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
    mapStoreRef.current.loadSnapshot(previous.map);
    stateRef.current.bank.replaceAll(previous.bank);
    stateRef.current.openThreads = previous.openThreads;
    setCanUndoMap(undoStackRef.current.length > 0);
    setCommandAck(null);
    markMapChanged();
  }, [markMapChanged]);

  const applyMapCommands = useCallback(
    (commands: AcceptedMapCommand[]) => {
      if (commands.length === 0) return;
      captureMapUndo();
      applyAcceptedMapCommands(commands, mapStoreRef.current, stateRef.current.bank);
      stateRef.current.openThreads = promoteOpenThreadsForUtterances(
        stateRef.current.openThreads,
        commandSourceUtteranceIds(commands),
      );
      setCommandAck({ text: commandAckText(commands) });
      markMapChanged();
    },
    [captureMapUndo, markMapChanged],
  );

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
  }, [draftCollapsed, draftHtml]);

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

  // Active anchor: from the most recent AI question/clarify message.
  const activeAnchor = [...msgs].reverse().find(
    (m) => m.role === "assistant" && m.questionAnchor
  )?.questionAnchor;

  // The draft highlight persists until the user clicks inside the draft to
  // dismiss it (clicks elsewhere never clear it). A new anchor re-shows it and
  // opens the draft if it was minimized.
  const [highlightAnchor, setHighlightAnchor] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!activeAnchor) return;
    setHighlightAnchor(activeAnchor);
    // Undock and expand so an anchored question actually reveals the draft span,
    // not just the toolbar dot. Mirrors revealDraftAnchor().
    setDraftDocked(false);
    setDraftCollapsed(false);
  }, [activeAnchor]);

  // When the highlight lands, select and scroll the rich draft text into view.
  // Record the anchor text so the selection handler can tell this app-created
  // selection apart from one the user actually made.
  useEffect(() => {
    anchorSelectionTextRef.current = highlightAnchor;
    if (!highlightAnchor) return;
    const editor = draftRef.current;
    if (editor) selectTextInElement(editor, highlightAnchor);
  }, [highlightAnchor, draftHtml]);

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
    const draftText = draftSelectionFocus?.text.trim();
    if (cards.length === 0 && !draftText) return undefined;
    return {
      ...(cards.length > 0 ? { cards } : {}),
      ...(draftText ? { draftText } : {}),
    };
  }, [contextSelectedCardIds, draftSelectionFocus, mapRevision]);

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

  // Seed with opening question only for a fresh session.
  useEffect(() => {
    if (persistedSession || initialMsgs.length > 0) return;
    setMsgs([
      {
        id: ++msgId,
        role: "assistant",
        text: "What are you trying to think through? Just start anywhere - there's no wrong place to begin.",
        mode: "question",
      },
    ]);
  }, [initialMsgs.length, persistedSession]);

  function buildUnderstandingForOutput(out: TurnOutput): UnderstandingSnapshot {
    const stateForUnderstanding = stateRef.current;
    const configForUnderstanding = configRef.current;
    const mirrorEligibleBank = stateForUnderstanding.bank.getAll().filter((u) => !u.commandOnly && !u.nonHarvestable);
    return out.understanding ??
      buildUnderstanding({
        out,
        candidates: stateForUnderstanding.candidates.getAll(),
        readiness: stateForUnderstanding.candidates
          .getAll()
          .map((candidate) => evaluateReadiness(candidate, mirrorEligibleBank, configForUnderstanding)),
        bank: stateForUnderstanding.bank,
        draftDeclarations: detectDraftDeclarations(
          stateForUnderstanding.draft,
          configForUnderstanding.draftDeclarations,
        ),
        clarifyTarget: stateForUnderstanding.clarifyTarget,
        activeElicitation: stateForUnderstanding.activeElicitation,
        pendingMapCommand: stateForUnderstanding.pendingMapCommand,
        openThreads: stateForUnderstanding.openThreads,
        config: configForUnderstanding,
      });
  }

  function appendCoachOutput(out: TurnOutput, opts?: { replaceLastCoach?: boolean }) {
    const understanding = buildUnderstandingForOutput(out);
    // When a turn replaces the previous coach message (e.g. an Under the Hood
    // "next move" click), drop that message instead of stacking a duplicate. If
    // it carried an undecided mirror, clear it so no orphan card lingers.
    const replaceLastCoach =
      Boolean(opts?.replaceLastCoach) &&
      msgs.length > 0 &&
      msgs[msgs.length - 1].role === "assistant";
    const replacedMirrorId = replaceLastCoach ? msgs[msgs.length - 1].mirrorId : undefined;
    if (replacedMirrorId) {
      setPendingMirrors((prev) => {
        if (!prev.has(replacedMirrorId)) return prev;
        const next = new Map(prev);
        next.delete(replacedMirrorId);
        return next;
      });
    }
    setLastCoachDebug({
      mode: out.mode,
      suppressionReason: out.suppressionReason as SuppressionReason | undefined,
      suppressionDetail: out.suppressionDetail,
      validationDebug: out.validationDebug,
      acceleratedCandidateIds: out.acceleratedCandidateIds,
      readinessNotes: out.readinessNotes,
      commandDebug: out.commandDebug,
    });

    applyMapCommands(out.mapCommands ?? []);

    const newMsg: ChatMsg = {
      id: ++msgId,
      role: "assistant",
      text: out.text,
      mode: out.mode,
      questionAnchor: out.questionAnchor,
      questionStance: out.questionStance,
    };

    if (out.validatedMirror) {
      const mirrorId = `m_${Date.now()}_${newMsg.id}`;
      newMsg.mirrorId = mirrorId;
      const initialDecisions: Record<string, ClaimDecision> = {};
      const initialEditedTexts: Record<string, string> = {};
      for (const c of out.validatedMirror.claims) {
        initialDecisions[c.claimId] = "pending";
      }
      for (const c of out.validatedMirror.reflection.claims) {
        initialEditedTexts[c.id] = c.text;
      }
      setPendingMirrors((prev) => {
        const next = new Map(prev);
        next.set(mirrorId, {
          id: mirrorId,
          reflection: out.validatedMirror!.reflection,
          claims: out.validatedMirror!.claims,
          decisions: initialDecisions,
          editedTexts: initialEditedTexts,
        });
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
    if (typeof window === "undefined" || msgs.length === 0) return;
    const snapshot: PersistedSession = {
      version: 1,
      msgs,
      pendingMirrors: Array.from(pendingMirrors.values()),
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
      controller: {
        mode: stateRef.current.mode,
        turnsSinceLastMirror: stateRef.current.turnsSinceLastMirror,
        clarifyTarget: stateRef.current.clarifyTarget,
        lastAiText: stateRef.current.lastAiText,
        prevAiText: stateRef.current.prevAiText,
        coverageFocus: stateRef.current.coverageFocus,
        draft: stateRef.current.draft,
        pendingMapCommand: stateRef.current.pendingMapCommand,
        organizeFocus: stateRef.current.organizeFocus,
        pendingChildPlacement: stateRef.current.pendingChildPlacement,
        activeElicitation: stateRef.current.activeElicitation,
        activeSelectionContext: stateRef.current.activeSelectionContext,
        openThreads: stateRef.current.openThreads,
        dismissedCandidateIds: stateRef.current.dismissedCandidateIds,
        pendingCardWording: stateRef.current.pendingCardWording,
        captureLoop: stateRef.current.captureLoop,
        lastCoachQuestion: stateRef.current.lastCoachQuestion,
      },
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
    draftCollapsed,
    draftDocked,
    draftHtml,
    draftPos,
    draftSize,
    draftText,
    lastCoachDebug,
    understandingSnapshot,
    mapRevision,
    msgs,
    pendingMirrors,
    questionBias,
    requireConnectionLabel,
  ]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const nonce = ++turnNonceRef.current;

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

    setMsgs((prev) => [
      ...prev,
      { id: ++msgId, role: "user", text },
    ]);

    setLoading(true);
    try {
      const workingState = cloneLoopState(stateRef.current);
      const out = await processTurn(
        workingState,
        text,
        llmRef.current,
        configRef.current,
        "chat",
        mapStoreRef.current.toLLMContext(),
        { requireConnectionLabel, selectedFocus },
      );

      if (nonce !== turnNonceRef.current) return;
      mergeLiveBankIntoWorkingState(workingState, stateRef.current);
      stateRef.current = workingState;
      appendCoachOutput(out);
    } catch (e) {
      if (nonce !== turnNonceRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      if (nonce === turnNonceRef.current) setLoading(false);
    }
  }

  // User-initiated override of the coach's next move, triggered from the Under
  // the Hood panel. Runs a coach turn with no synthetic user message (mirrors
  // the mirror-continuation path); `overrideMode` clears any wedged pending
  // state and forces the requested mode via the prompt. The result replaces the
  // previous coach message rather than stacking a duplicate.
  async function requestMode(mode: UserRequestedMode) {
    if (loading) return;
    const nonce = ++turnNonceRef.current;

    speech.stop();
    setError(null);

    setLoading(true);
    try {
      const workingState = cloneLoopState(stateRef.current);
      const out = await processTurn(
        workingState,
        "",
        llmRef.current,
        configRef.current,
        "chat",
        mapStoreRef.current.toLLMContext(),
        { ingestUser: false, requireConnectionLabel, overrideMode: mode, selectedFocus },
      );

      if (nonce !== turnNonceRef.current) return;
      mergeLiveBankIntoWorkingState(workingState, stateRef.current);
      stateRef.current = workingState;
      appendCoachOutput(out, { replaceLastCoach: true });
    } catch (e) {
      if (nonce !== turnNonceRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      if (nonce === turnNonceRef.current) setLoading(false);
    }
  }

  async function decideClaim(mirrorId: string, claimId: string, decision: "confirmed" | "declined") {
    if (loading) return;
    const pm = pendingMirrors.get(mirrorId);
    if (!pm || pm.decisions[claimId] !== "pending") return;
    const resolution = resolveMirrorDecision(pm.decisions, claimId, decision);

    const claim = pm.reflection.claims.find((c) => c.id === claimId);
    const declinedClaim =
      decision === "declined"
        ? claim
        : pm.reflection.claims.find((c) => resolution.nextDecisions[c.id] === "declined");
    const editedText = (pm.editedTexts[claimId] ?? claim?.text ?? "").trim();
    const finalText = editedText || claim?.text;
    const declinedText = declinedClaim
      ? (pm.editedTexts[declinedClaim.id] ?? declinedClaim.text).trim() || declinedClaim.text
      : undefined;
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
        };
      }
    }

    setPendingMirrors((prev) => {
      const pm = prev.get(mirrorId);
      if (!pm) return prev;
      const next = new Map(prev);
      const updated: PendingMirror = {
        ...pm,
        decisions: resolution.nextDecisions,
      };
      next.set(mirrorId, updated);

      // Remove the mirror card once all claims are decided.
      if (resolution.allDecided) next.delete(mirrorId);

      return next;
    });

    if (confirmedReflection) {
      captureMapUndo();
      mapStoreRef.current.addFromReflection(confirmedReflection);
      stateRef.current.openThreads = promoteOpenThreadsForUtterances(
        stateRef.current.openThreads,
        confirmedReflection.sourceUtteranceIds,
      );
      setConfirmed((prev) => [...prev, confirmedReflection]);
      markUserMapChanged();
    }

    if (resolution.allDecided && resolution.anyDeclined && declinedClaim) {
      const text = `What wording should change before I carry "${declinedText ?? declinedClaim.text}" forward?`;
      const repairOut: TurnOutput = {
        mode: "clarify",
        text,
        llmTurn: { mode: "clarify", text },
        questionStance: "narrow",
      };
      stateRef.current.mode = "clarify";
      stateRef.current.turnsSinceLastMirror++;
      // Only surface the user's OWN wording in Under the Hood - never the mirror
      // claim's phrasing (which is AI-authored). Fall back to undefined so UTH
      // shows a neutral "that idea" rather than leaking generated prose. (The
      // chat message above may quote the claim; chat is not UTH-restricted.)
      const declinedUserEdit =
        (pm.editedTexts[declinedClaim.id] ?? "").trim() !== declinedClaim.text.trim()
          ? (pm.editedTexts[declinedClaim.id] ?? "").trim()
          : undefined;
      stateRef.current.activeElicitation = {
        kind: "clarify_after_failed_mirror",
        targetPhrase: declinedUserEdit || undefined,
      };
      stateRef.current.prevAiText = stateRef.current.lastAiText;
      stateRef.current.lastAiText = text;
      const msgIdForTrace = ++msgId;
      setMsgs((prev) => [
        ...prev,
        { id: msgIdForTrace, role: "assistant", text, mode: repairOut.mode, questionStance: repairOut.questionStance },
      ]);
      setUnderstandingSnapshot(buildUnderstandingForOutput(repairOut));
      return;
    }

    if (resolution.shouldContinue) {
      const nonce = ++turnNonceRef.current;
      const continuationFocus = pm.reflection.claims
        .filter((pendingClaim) => resolution.nextDecisions[pendingClaim.id] === "confirmed")
        .map((pendingClaim) => (pm.editedTexts[pendingClaim.id] ?? pendingClaim.text).trim() || pendingClaim.text);
      setLoading(true);
      try {
        const workingState = cloneLoopState(stateRef.current);
        const out = await processTurn(
          workingState,
          "",
          llmRef.current,
          configRef.current,
          "chat",
          mapStoreRef.current.toLLMContext(),
          { ingestUser: false, requireConnectionLabel, continuationFocus, selectedFocus },
        );
        if (nonce !== turnNonceRef.current) return;
        mergeLiveBankIntoWorkingState(workingState, stateRef.current);
        stateRef.current = workingState;
        appendCoachOutput(out);
      } catch (e) {
        if (nonce !== turnNonceRef.current) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        if (nonce === turnNonceRef.current) setLoading(false);
      }
    }
  }

  function editMirrorClaim(mirrorId: string, claimId: string, text: string) {
    setPendingMirrors((prev) => {
      const pm = prev.get(mirrorId);
      if (!pm || pm.decisions[claimId] !== "pending") return prev;
      const next = new Map(prev);
      next.set(mirrorId, {
        ...pm,
        editedTexts: {
          ...pm.editedTexts,
          [claimId]: text,
        },
      });
      return next;
    });
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
    turnNonceRef.current++;
    setLoading(false);
    llmRef.current = makeLLM(() => configRef.current, buildConversationHistory(msgs));
    mapStoreRef.current = new ThoughtUnitStore();
    undoStackRef.current = [];
    setCanUndoMap(false);
    setCommandAck(null);
    setPendingMirrors(new Map());
    setConfirmed([]);
    stateRef.current.pendingMapCommand = undefined;
    stateRef.current.organizeFocus = undefined;
    stateRef.current.coverageFocus = undefined;
    stateRef.current.pendingChildPlacement = undefined;
    stateRef.current.activeElicitation = undefined;
    stateRef.current.openThreads = reopenPromotedOpenThreads(stateRef.current.openThreads);
    stateRef.current.pendingCardWording = undefined;
    stateRef.current.captureLoop = undefined;
    setContextSelectedCardIds(new Set());
    setMapMountKey((key) => key + 1);
    markMapChanged();
  }

  function clearDraftOnly() {
    turnNonceRef.current++;
    setLoading(false);
    llmRef.current = makeLLM(() => configRef.current, buildConversationHistory(msgs));
    setDraftText("");
    setDraftHtml("");
    setHighlightAnchor(undefined);
    setDraftSelectionFocus(undefined);
    stateRef.current.draft = "";
  }

  function clearChatOnly() {
    turnNonceRef.current++;
    setLoading(false);
    const draft = draftText;
    stateRef.current = createState();
    stateRef.current.draft = draft;
    llmRef.current = makeLLM(() => configRef.current);
    setMsgs([
      {
        id: ++msgId,
        role: "assistant",
        text: "What are you trying to think through? Just start anywhere - there's no wrong place to begin.",
        mode: "question",
      },
    ]);
    setPendingMirrors(new Map());
    setLastCoachDebug(null);
    setUnderstandingSnapshot(null);
    setHighlightAnchor(undefined);
    undoStackRef.current = [];
    setCanUndoMap(false);
    setCommandAck(null);
    setError(null);
    setInput("");
    speech.stop();
    speech.reset();
  }

  return (
    <>
      <style>{css}</style>
      <div className="layout">
        {/* Chat panel */}
        <div className="chat-panel">
          <div className="chat-header">
            <div className="chat-header-actions chat-header-actions-left">
              <button className="reset-btn" onClick={clearChatOnly} title="Clear the chat conversation only">
                Clear chat
              </button>
            </div>
            <label className="question-bias chat-question-bias">
              <span>Think</span>
              <input
                type="range"
                min={0}
                max={100}
                step={25}
                list="question-bias-ticks"
                value={questionBias}
                aria-label="Question framing bias"
                onChange={(event) => setQuestionBias(Number(event.target.value))}
              />
              <datalist id="question-bias-ticks">
                <option value="0" />
                <option value="25" />
                <option value="50" />
                <option value="75" />
                <option value="100" />
              </datalist>
              <span>Map</span>
            </label>
          </div>

          <div className="messages">
            {msgs.map((m) => (
              <div key={m.id} className={`msg ${m.role} ${m.mode ?? ""}`}>
                <span className="msg-label">
                  {m.role === "user" ? "you" : "coach"}
                  {m.questionStance && (
                    <span className={`stance-chip stance-${m.questionStance}`}>{m.questionStance}</span>
                  )}
                </span>
                <div className="msg-bubble">{m.text}</div>
                {m.mirrorId && pendingMirrors.has(m.mirrorId) && (
                  <MirrorCard
                    pm={pendingMirrors.get(m.mirrorId)!}
                    onDecide={(claimId, d) => decideClaim(m.mirrorId!, claimId, d)}
                    onEdit={(claimId, text) => editMirrorClaim(m.mirrorId!, claimId, text)}
                  />
                )}
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
            <div className="input-row">
              <textarea
                ref={textareaRef}
                className={`composer-textarea ${composerScrollable ? "composer-scroll" : ""}`}
                rows={2}
                placeholder="Say what's on your mind…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKey}
                disabled={loading}
              />
              <div className="composer-toolbar">
                <div className="composer-left-tools">
                  <button
                    className={`uth-toggle-btn ${underhoodOpen ? "active" : ""}`}
                    type="button"
                    title={underhoodOpen ? "Close under the hood" : "Open under the hood"}
                    aria-label={underhoodOpen ? "Close under the hood panel" : "Open under the hood panel"}
                    aria-pressed={underhoodOpen}
                    onClick={() => setUnderhoodOpen((value) => !value)}
                  >
                    <UnderhoodIcon />
                    <span>UTH</span>
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
                  <button className="send-btn" onClick={() => void send()} disabled={loading || !input.trim()}>
                    {"\u2191"}
                  </button>
                </div>
              </div>
            </div>
            <div className="input-hint">Enter to send {"\u00b7"} Shift+Enter for newline</div>
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
            onDraftAnchor={revealDraftAnchor}
            onRequestMode={requestMode}
            onDismissIdea={dismissTrackedIdea}
            busy={loading}
            open={underhoodOpen}
            onOpenChange={setUnderhoodOpen}
          />
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Mirror confirmation card
// ---------------------------------------------------------------------------

function MirrorCard({
  pm,
  onDecide,
  onEdit,
}: {
  pm: PendingMirror;
  onDecide: (claimId: string, decision: "confirmed" | "declined") => void;
  onEdit: (claimId: string, text: string) => void;
}) {
  return (
    <div className="mirror-card">
      <span className="mirror-card-label">Edit if needed, then confirm</span>
      <div className="mirror-claims">
        {pm.reflection.claims.map((claim, index) => {
          const decision = pm.decisions[claim.id] ?? "pending";
          const text = pm.editedTexts[claim.id] ?? claim.text;
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
