import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent } from "react";
import { historyForCurrentTurn, makeLLM, type ConversationMessage, type ProviderRuntimeConfig } from "./api";
import { defaultConfig, withQuestionIntentBias, type MindmapConfig } from "./config";
import type { AssistantResponse, ConversationState, DiagnosticEvent, TurnProgressStage, TurnResult } from "./assistant-response";
import type { ProposalOutcomeContext, SelectedFocusContext, UserRequestedMode } from "./llm-contract";
import { pruneContextSelection, ThoughtMap, toggleContextSelection, type CoachDebugInfo, type MapCommandAcknowledgement } from "./Map";
import { ThoughtUnitStore, type ThoughtUnitStoreSnapshot } from "./map-store";
import { applyConfirmedReflection, applyGatewayActions, executeCanvasAction, inspectAction, type ProposedAction } from "./action-gateway";
import { createProposalStore, resolveProposal, updateProposal, type Proposal } from "./proposal-store";
import { cloneConversationState, createConversationState, mergeConversationBank, processTurn } from "./stage1-loop";
import { cardRef } from "./store";
import type { CandidateThought, ThoughtUnit, ThoughtUnitRole } from "./types";
import type { ConfirmedReflection } from "./types";
import { validateMirror } from "./validator";
import { buildDiagnosticSnapshot, type UnderstandingSnapshot } from "./understanding";
import { useSpeechToText } from "./useSpeechToText";
import { measureDraftAnchorRects, scrollDraftAnchorIntoView, type DraftAnchorRect } from "./draft-anchor";
import { ASSISTANCE_CONTRACTS, contractForLevel, DEFAULT_ASSISTANCE_CONTRACT, normalizeInfluenceTrace, snapshotContract, type AssistanceLevel } from "./assistance-contract";
import { EventLedger, type LedgerEventKind } from "./event-ledger";
import { reconcileStoreSuggestionAdoption, type VisibleSuggestion } from "./suggestion-adoption";
import { provenanceTotals } from "./provenance-summary";
import { useMutationAccess } from "./mutation-policy";
import { interpolateUi, useUiLocale } from "./ui-locale";
import { useReaderView } from "./reader-view";
import { UnderTheHoodPanel } from "./ControlRoom";
import {
  loadPersistedSession,
  writePersistedSession,
  type ChatMsg,
  type ClaimDecision,
  type DraftPanelPos,
  type DraftPanelSize,
  type DraftSelectionFocus,
  type DraftSourceMetadata,
  type PersistedPendingMirror,
  type PersistedSession,
} from "./session-persistence";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MapUndoSnapshot {
  map: ThoughtUnitStoreSnapshot;
  bank: ReturnType<ConversationState["bank"]["getAll"]>;
}

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
const WORKING_INDICATOR_DELAY_MS = 700;

export const TURN_PROGRESS_COPY: Record<TurnProgressStage, string> = {
  grounding_repair: "Making sure this stays in your words...",
  forced_question: "Asking a focused question instead...",
};

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
    min-height: 0;
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
  .ai-suggestion-badge,
  .ai-translation-badge {
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
  .ai-translation-badge { border-color: #92c8d4; background: #eaf8fa; color: #176c7a; }
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
    background: #f0efeb;
    color: #1a1a1a;
    border-bottom-left-radius: 4px;
  }
  .msg.assistant.mirror .msg-bubble  { background: #e8f8ed; }
  .msg.assistant.clarify .msg-bubble { background: #fff3e0; }
  .msg.application .msg-bubble { background: #fff7e3; color: #5d4200; border: 1px solid #edd49a; }
  .recovery-actions { margin-top: 7px; }

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
    height: auto;
    min-height: 0;
    min-width: 0;
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
  @media (max-width: 1320px) {
    .map-header { grid-template-columns: auto minmax(0, 1fr); }
    .map-right-tools { grid-column: 1 / -1; justify-self: stretch; justify-content: flex-end; }
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
    min-width: 0;
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
  .map-origin-badge { padding: 2px 5px; border-radius: 8px; background: #f1e7ff; color: #70459a; font-size: 10px; font-weight: 700; }
  .map-origin-badge-connected { background: #e8f2ee; color: #356b56; }
  .assistance-contract { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: #666; }
  .assistance-contract select {
    appearance: none;
    -webkit-appearance: none;
    border: 1px solid #dcdad4;
    border-radius: 8px;
    background-color: #fff;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5L5 6.5L8 3.5' fill='none' stroke='%231a6fa3' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 8px center;
    padding: 5px 26px 5px 10px;
    font-size: 11px;
    font-weight: 600;
    color: #4f4b45;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .assistance-contract select:hover { border-color: #b9c9d5; }
  .assistance-contract select:focus {
    outline: none;
    border-color: #1a6fa3;
    box-shadow: 0 0 0 3px rgba(26, 111, 163, 0.15);
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
  .ui-locale-control {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #57606a;
    font-size: 11px;
    white-space: nowrap;
  }
  .ui-locale-control select {
    max-width: 168px;
    border: 1px solid #d0d7de;
    border-radius: 7px;
    background: #fff;
    color: #24292f;
    padding: 5px 7px;
    font: inherit;
  }
  [dir="rtl"] .ui-locale-control select {
    text-align: right;
  }
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
  .map-render-recovery {
    position: absolute;
    inset: 18px;
    display: grid;
    place-content: center;
    gap: 10px;
    text-align: center;
    color: #5d5a54;
    background: rgba(255,255,252,0.92);
    border: 1px solid #d8d4ca;
    border-radius: 10px;
    z-index: 5;
  }
  .reader-status-banner {
    background: #eef7fd;
    color: #1a5b82;
    font-size: 12px;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #c8e0ef;
  }
  .reader-rejection {
    margin-top: 7px;
    padding: 6px 8px;
    border-radius: 6px;
    background: #fff8e5;
    color: #734d00;
    border: 1px solid #e8c675;
    font-weight: 650;
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
  .draft-source-label {
    margin-left: auto;
    max-width: 260px;
    font-size: 10px;
    line-height: 1.2;
    color: #76694f;
    text-align: right;
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

  .draft-anchor-overlay {
    position: absolute;
    inset: 0;
    z-index: 2;
    overflow: hidden;
    pointer-events: none;
  }
  .draft-anchor-mark {
    position: absolute;
    border-radius: 3px;
    background: rgba(255, 213, 79, 0.48);
    box-shadow: inset 0 -1px 0 rgba(166, 116, 0, 0.35);
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
    display: flex;
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
  .event-row.provenance-row { grid-template-columns: minmax(0, 1fr) auto; }
  .event-row.provenance-row::after { display: none; }
  .event-row.provenance-row .event-title { min-width: 0; }
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

export function buildConversationHistory(msgs: ChatMsg[]): ConversationMessage[] {
  return msgs.flatMap((msg) =>
    (msg.role === "user" || msg.role === "assistant") &&
    msg.deliveryStatus !== "pending" &&
    msg.deliveryStatus !== "failed"
      ? [{ role: msg.role, content: msg.text }]
      : [],
  );
}

export function restoreFailedMessageToComposer(
  msgs: ChatMsg[],
  input: string,
  messageId: number,
): { msgs: ChatMsg[]; input: string } {
  const failed = msgs.find(
    (message) =>
      message.id === messageId &&
      message.role === "user" &&
      message.deliveryStatus === "failed",
  );
  if (!failed) return { msgs, input };
  return {
    msgs: msgs.filter((message) => message.id !== messageId),
    input: input ? `${failed.text}\n\n${input}` : failed.text,
  };
}

export function recoverFailedTurn(
  msgs: ChatMsg[],
  input: string,
  message: ChatMsg,
): { msgs: ChatMsg[]; input: string } {
  if (!input) {
    return {
      msgs: msgs.filter((candidate) => candidate.id !== message.id),
      input: message.text,
    };
  }
  return {
    msgs: msgs.map((candidate) =>
      candidate.id === message.id
        ? { ...candidate, deliveryStatus: "failed" }
        : candidate,
    ),
    input,
  };
}

export function deriveCurrentUserTurn(bank: Array<{ turnId?: string }>): number {
  return bank.reduce((highest, utterance) => {
    const match = utterance.turnId?.match(/^t_(\d+)$/);
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0);
}

export function migrateCandidateMemory(candidates: CandidateThought[], currentUserTurn: number, dismissedIds: string[] = []): CandidateThought[] {
  const dismissed = new Set(dismissedIds);
  return candidates.map((candidate) => {
    const status = candidate.status === "active" || candidate.status === "parked" || candidate.status === "ignored" || candidate.status === "promoted"
      ? candidate.status
      : dismissed.has(candidate.id) ? "ignored" as const : "active" as const;
    return {
      ...candidate,
      status,
      createdTurn: Number.isFinite(candidate.createdTurn) ? candidate.createdTurn : currentUserTurn,
      lastTouchedTurn: Number.isFinite(candidate.lastTouchedTurn) ? candidate.lastTouchedTurn : currentUserTurn,
      ...(status === "ignored" && candidate.ignoredAtTurn === undefined ? { ignoredAtTurn: currentUserTurn } : {}),
    };
  });
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

export interface AppProps {
  providerRuntime?: ProviderRuntimeConfig;
  initialDraft?: { text: string; source?: DraftSourceMetadata };
  aiAccessDenied?: boolean;
}

export default function App({ providerRuntime, initialDraft, aiAccessDenied = false }: AppProps) {
  const { locale, t } = useUiLocale();
  const reader = useReaderView();
  const mutationAccess = useMutationAccess();
  const readOnly = mutationAccess.mode === "translated_view";
  const persistedSession = useMemo(() => loadPersistedSession(), []);
  const initialContract = contractForLevel(persistedSession?.assistanceLevel ?? 0);
  const initialSessionId = persistedSession?.sessionId ?? newSessionId();

  const initialState = useMemo(() => {
    const state = createConversationState();
    if (!persistedSession) {
      state.draft = initialDraft?.text ?? "";
      return state;
    }
    state.bank.replaceAll(persistedSession.bank);
    const currentUserTurn = persistedSession.conversation?.currentUserTurn ?? deriveCurrentUserTurn(persistedSession.bank);
    const legacyIgnoredCandidateIds = persistedSession.conversation?.legacyIgnoredCandidateIds
      ?? persistedSession.conversation?.dismissedCandidateIds
      ?? persistedSession.controller?.dismissedCandidateIds
      ?? [];
    state.currentUserTurn = currentUserTurn;
    state.latestUserLanguagePattern = persistedSession.conversation?.latestUserLanguagePattern ?? "unknown";
    state.legacyIgnoredCandidateIds = legacyIgnoredCandidateIds;
    state.candidates.replaceAll(migrateCandidateMemory(persistedSession.candidates, currentUserTurn, legacyIgnoredCandidateIds));
    state.candidates.setLegacyIgnoredIds(legacyIgnoredCandidateIds);
    state.turnsSinceLastReflection = persistedSession.conversation?.turnsSinceLastReflection ?? persistedSession.controller?.turnsSinceLastMirror ?? 0;
    state.lastAssistantText = persistedSession.conversation?.lastAssistantText ?? persistedSession.controller?.lastAiText ?? "";
    state.draft = persistedSession.conversation?.draft ?? persistedSession.controller?.draft ?? persistedSession.draftText;
    state.currentDraftSnapshotId = persistedSession.conversation?.currentDraftSnapshotId;
    state.draftSnapshotText = persistedSession.conversation?.draftSnapshotText;
    return state;
  }, [initialDraft?.text, persistedSession]);

  const initialMapStore = useMemo(() => {
    const store = new ThoughtUnitStore();
    if (persistedSession) {
      executeCanvasAction({ kind: "restore_snapshot", snapshot: persistedSession.map }, { store, bank: initialState.bank, interactionMode: "authoring", origin: "system_restore" });
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
  // Rebuild transparency from code-owned memory rather than trusting persisted
  // display prose. This keeps ignored memories restorable immediately after reload.
  const initialUnderstandingSnapshot = persistedSession
    ? buildDiagnosticSnapshot([], initialState.candidates.getAll(), initialState.bank.getAll(), initialState.currentUserTurn)
    : null;
  const initialMapRevision = persistedSession?.mapRevision ?? 0;
  const initialQuestionBias = snapQuestionBias(persistedSession?.questionBias ?? 35);
  const initialRequireConnectionLabel = persistedSession?.requireConnectionLabel ?? true;
  const initialDraftText = persistedSession?.draftText ?? initialDraft?.text ?? "";
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
  const initialDraftSource = persistedSession?.draftSource ?? initialDraft?.source;

  const stateRef = useRef<ConversationState>(initialState);
  const configRef = useRef<MindmapConfig>(withQuestionIntentBias(defaultConfig, initialQuestionBias));
  const mapStoreRef = useRef<ThoughtUnitStore>(initialMapStore);
  const undoStackRef = useRef<MapUndoSnapshot[]>([]);

  const [msgs, setMsgs] = useState<ChatMsg[]>(initialMsgs);
  const msgsRef = useRef<ChatMsg[]>(initialMsgs);
  const [proposals, setProposals] = useState(initialProposals);
  const [confirmed, setConfirmed] = useState<ConfirmedReflection[]>(initialConfirmed);
  const [lastCoachDebug, setLastCoachDebug] = useState<CoachDebugInfo | null>(initialCoachDebug);
  const [understandingSnapshot, setUnderstandingSnapshot] = useState<UnderstandingSnapshot | null>(initialUnderstandingSnapshot);
  const [diagnostics, setDiagnostics] = useState<DiagnosticEvent[]>(persistedSession?.diagnostics ?? []);
  const [mapRevision, setMapRevision] = useState(initialMapRevision);
  const [mapMountKey, setMapMountKey] = useState(0);
  const [questionBias, setQuestionBias] = useState(initialQuestionBias);
  const [assistanceLevel, setAssistanceLevel] = useState<AssistanceLevel>(initialContract.level);
  const [ledgerAvailable, setLedgerAvailable] = useState(true);
  const [requireConnectionLabel, setRequireConnectionLabel] = useState(initialRequireConnectionLabel);
  const [canUndoMap, setCanUndoMap] = useState(false);
  const [commandAck, setCommandAck] = useState<MapCommandAcknowledgement | null>(null);
  const [loading, setLoading] = useState(false);
  const [showWorking, setShowWorking] = useState(false);
  const [turnProgress, setTurnProgress] = useState<TurnProgressStage | null>(null);
  const [input, setInput] = useState("");
  const inputRef = useRef(input);
  inputRef.current = input;
  const [composerScrollable, setComposerScrollable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [underhoodOpen, setUnderhoodOpen] = useState(false);
  const [contextSelectedCardIds, setContextSelectedCardIds] = useState<Set<string>>(new Set());
  const [draftSelectionFocus, setDraftSelectionFocus] = useState<DraftSelectionFocus | undefined>(undefined);
  const [stickyDraftFocus, setStickyDraftFocus] = useState<DraftSelectionFocus | undefined>(initialStickyDraftFocus);
  const [draftSource, setDraftSource] = useState<DraftSourceMetadata | undefined>(initialDraftSource);
  const ledgerRef = useRef(new EventLedger(initialSessionId));
  const contract = contractForLevel(assistanceLevel);

  const recordEvent = useCallback(async (kind: LedgerEventKind, detail?: unknown, extra?: { origin?: import("./assistance-contract").ContributionOrigin; responseKind?: string; outcome?: string; code?: string; durationMs?: number; contract?: import("./assistance-contract").AssistanceContractSnapshot; providerTransport?: "chat_json" | "responses_tools"; toolName?: "propose_reflection_v1" | "propose_map_action_v1"; repairCount?: number; candidateStatus?: "active" | "parked" | "ignored" | "promoted"; ageInTurns?: number; currentPercentage?: number; peakPercentage?: number }) => {
    await ledgerRef.current.record(kind, detail, { ...extra, contract: extra?.contract ?? snapshotContract(contract) });
    setLedgerAvailable(ledgerRef.current.isAvailable);
  }, [contract]);

  useEffect(() => { msgsRef.current = msgs; }, [msgs]);

  useEffect(() => {
    if (!loading) {
      setShowWorking(false);
      return;
    }
    const timer = window.setTimeout(() => setShowWorking(true), WORKING_INDICATOR_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    void recordEvent(persistedSession ? "contract_selected" : "contract_initialized", { reason: persistedSession ? "migration" : "new_session" });
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

  const captureUserMapUndo = useCallback(() => {
    mutationAccess.run("canvas_edit", captureMapUndo);
  }, [captureMapUndo, mutationAccess]);

  const changeConnectionSetting = useCallback((value: boolean) => {
    mutationAccess.run("connection_setting", () => setRequireConnectionLabel(value));
  }, [mutationAccess]);

  const reconcileMapSuggestionProvenance = useCallback((textChangedCardIds: readonly string[] = []) => {
    const suggestions: VisibleSuggestion[] = msgsRef.current
      .filter((message) => message.role === "assistant" && message.responseKind === "suggestion")
      .map((message) => ({ id: message.id, text: message.text }));
    for (const change of reconcileStoreSuggestionAdoption(mapStoreRef.current, suggestions, new Set(textChangedCardIds))) {
      void recordEvent("suggestion_adoption_changed", { cardId: change.cardId, trace: change.after }, {
        origin: "ai_suggested", outcome: change.before ? "updated" : "adopted",
        currentPercentage: Math.round(change.after.currentOverlapRatio * 100), peakPercentage: Math.round(change.after.peakOverlapRatio * 100),
      });
    }
  }, [recordEvent]);

  const markMapChanged = useCallback((textChangedCardIds: readonly string[] = []) => {
    reconcileMapSuggestionProvenance(textChangedCardIds);
    setMapRevision((v) => v + 1);
  }, [reconcileMapSuggestionProvenance]);

  const markUserMapChanged = useCallback((textChangedCardIds: readonly string[] = []) => {
    if (!mutationAccess.allows("canvas_edit")) return;
    setCommandAck(null);
    markMapChanged(textChangedCardIds);
  }, [markMapChanged, mutationAccess]);

  const undoMapChange = useCallback(() => {
    if (!mutationAccess.allows("map_undo")) return;
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    executeCanvasAction({ kind: "restore_snapshot", snapshot: previous.map }, { store: mapStoreRef.current, bank: stateRef.current.bank, interactionMode: mutationAccess.mode, origin: "system_restore" });
    stateRef.current.bank.replaceAll(previous.bank);
    setCanUndoMap(undoStackRef.current.length > 0);
    setCommandAck(null);
    markMapChanged();
  }, [markMapChanged, mutationAccess]);

  const updateActionProposal = useCallback((proposalId: string, action: ProposedAction) => {
    if (!mutationAccess.allows("proposal_edit")) return;
    setProposals((current) => {
      const proposal = current.get(proposalId);
      if (!proposal || proposal.detail.kind !== "map_action") return current;
      return updateProposal(current, proposalId, {
        state: "edited",
        detail: { ...proposal.detail, action, executable: undefined, completion: undefined },
      });
    });
  }, [mutationAccess]);

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
    if (!mutationAccess.allows("proposal_resolve")) return;
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
    const existingCardIds = new Set(mapStoreRef.current.getAll().map((unit) => unit.id));
    const changedUnits = applyGatewayActions([checked.action], mapStoreRef.current, stateRef.current.bank, { origin: appliedOrigin, contract: proposal.contract, relationshipProvenance });
    const textChangedCardIds = checked.action.kind === "edit_card"
      ? changedUnits.filter((unit) => unit.role !== "connection_label").map((unit) => unit.id)
      : checked.action.kind === "create_card"
        ? changedUnits.filter((unit) => unit.role !== "connection_label" && !existingCardIds.has(unit.id)).map((unit) => unit.id)
        : [];
    const promotedCandidateId = proposal.detail.candidateId;
    if (promotedCandidateId && stateRef.current.candidates.transition(promotedCandidateId, "promoted", stateRef.current.currentUserTurn)) {
      void recordEvent("candidate_lifecycle_changed", { candidateId: promotedCandidateId, status: "promoted", turn: stateRef.current.currentUserTurn }, { outcome: "promoted", candidateStatus: "promoted" });
      setUnderstandingSnapshot((prev) => prev ? { ...prev, trackedIdeas: prev.trackedIdeas.filter((idea) => idea.id !== promotedCandidateId), ignoredIdeas: (prev.ignoredIdeas ?? []).filter((idea) => idea.id !== promotedCandidateId) } : prev);
    }
    setProposals((current) => resolveProposal(current, proposalId, "confirmed"));
    void recordEvent("proposal_resolved", { proposalId, decision: "confirmed" }, { origin: proposal.origin, outcome: "confirmed" });
    void recordEvent("map_mutated", { proposalId, action: checked.action }, { origin: proposal.origin, outcome: "applied" });
    setCommandAck({ text: "Map change confirmed." });
    const event: DiagnosticEvent = { id: `d_${Date.now()}`, at: Date.now(), stage: "application", outcome: "applied", code: "map_action_applied", detail: "The confirmed proposal was revalidated against the current map and applied." };
    setDiagnostics((current) => [...current, event].slice(-100));
    markMapChanged(textChangedCardIds);
    // A confirmation is meaningful user steering. Give the coach a fresh turn
    // against the already-updated map, without manufacturing chat text or
    // treating the decision as new source material.
    void requestMode(undefined, { proposalKind: "map_action", decision: "confirmed" }, mapRevision + 1);
  }, [captureMapUndo, groundEditedAction, mapRevision, markMapChanged, mutationAccess, proposals, recordEvent, requestMode, requireConnectionLabel]);

  const dismissTrackedIdea = useCallback((ideaId: string) => {
    if (!mutationAccess.allows("candidate_transition")) return;
    if (!stateRef.current.candidates.transition(ideaId, "ignored", stateRef.current.currentUserTurn)) return;
    void recordEvent("candidate_lifecycle_changed", { candidateId: ideaId, status: "ignored", turn: stateRef.current.currentUserTurn }, { outcome: "ignored", candidateStatus: "ignored" });
    setUnderstandingSnapshot((prev) =>
      prev
        ? {
            ...prev,
            trackedIdeas: prev.trackedIdeas.filter((idea) => idea.id !== ideaId),
            ignoredIdeas: [...(prev.ignoredIdeas ?? []), ...prev.trackedIdeas.filter((idea) => idea.id === ideaId).map((idea) => ({ ...idea, status: "ignored" as const, ageInTurns: 0 }))],
          }
        : prev,
    );
  }, [mutationAccess, recordEvent]);

  const restoreTrackedIdea = useCallback((ideaId: string) => {
    if (!mutationAccess.allows("candidate_transition")) return;
    if (!stateRef.current.candidates.transition(ideaId, "parked", stateRef.current.currentUserTurn)) return;
    void recordEvent("candidate_lifecycle_changed", { candidateId: ideaId, status: "parked", turn: stateRef.current.currentUserTurn }, { outcome: "restored", candidateStatus: "parked" });
    setUnderstandingSnapshot((prev) =>
      prev
        ? {
            ...prev,
            trackedIdeas: [...prev.trackedIdeas, ...(prev.ignoredIdeas ?? []).filter((idea) => idea.id === ideaId).map((idea) => ({ ...idea, status: "parked" as const, ageInTurns: 0 }))],
            ignoredIdeas: (prev.ignoredIdeas ?? []).filter((idea) => idea.id !== ideaId),
          }
        : prev,
    );
  }, [mutationAccess, recordEvent]);

  // Draft panel state
  const [draftText, setDraftText] = useState(initialDraftText);
  const [draftHtml, setDraftHtml] = useState(initialDraftHtml);
  const [draftCollapsed, setDraftCollapsed] = useState(initialDraftCollapsed);
  const [draftDocked, setDraftDocked] = useState(initialDraftDocked);
  const [highlightAnchor, setHighlightAnchor] = useState<string | undefined>(undefined);
  const [anchorRects, setAnchorRects] = useState<DraftAnchorRect[]>([]);
  const [anchorRevealRequest, setAnchorRevealRequest] = useState<{ id: number; anchor: string } | null>(null);
  const anchorRevealSequenceRef = useRef(0);
  const [draftDockTargetActive, setDraftDockTargetActive] = useState(false);
  const [draftPos, setDraftPos] = useState<DraftPanelPos>(initialDraftPos);
  const [draftSize, setDraftSize] = useState<DraftPanelSize>(initialDraftSize);
  // Where the collapsed chip sat before it was expanded, so collapsing returns
  // it there instead of leaving it at the (shifted) panel position.
  const preExpandChipPosRef = useRef<DraftPanelPos | null>(null);
  const draftPanelRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    reader.prefetch([
      ...msgs.map((message) => message.terminal === "repair_failed" ? "" : message.text),
      draftText,
      stickyDraftFocus ? focusSummary(stickyDraftFocus.text) : "",
    ]);
  }, [draftText, msgs, reader.prefetch, stickyDraftFocus]);

  const requestDraftAnchorReveal = useCallback((anchor: string | undefined) => {
    const text = anchor?.trim();
    if (!text) return;
    setAnchorRevealRequest({ id: ++anchorRevealSequenceRef.current, anchor: text });
  }, []);

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
    setDraftSelectionFocus(text ? { text } : undefined);
  }, []);

  const syncDraftFromEditor = useCallback((editor: HTMLDivElement) => {
    const html = sanitizeDraftHtml(editor.innerHTML);
    setDraftHtml(html);
    setDraftText(draftHtmlToPlainText(html));
  }, []);

  const handleDraftInput = useCallback((event: FormEvent<HTMLDivElement>) => {
    if (!mutationAccess.allows("draft_edit")) return;
    syncDraftFromEditor(event.currentTarget);
    setDraftSelectionFocus(undefined);
  }, [mutationAccess, syncDraftFromEditor]);

  const handleDraftPaste = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
    if (!mutationAccess.allows("draft_edit")) {
      event.preventDefault();
      return;
    }
    const plainText = event.clipboardData.getData("text/plain");
    const html = event.clipboardData.getData("text/html");
    const pastedHtml = normalizeDraftPasteHtml(plainText, html);
    if (!pastedHtml) return;

    event.preventDefault();
    insertDraftHtmlAtSelection(event.currentTarget, pastedHtml);
    syncDraftFromEditor(event.currentTarget);
    setDraftSelectionFocus(undefined);
  }, [mutationAccess, syncDraftFromEditor]);

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
        requestDraftAnchorReveal(highlightAnchor);
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
        requestDraftAnchorReveal(highlightAnchor);
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
  }, [highlightAnchor, requestDraftAnchorReveal]);

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
  useEffect(() => {
    setHighlightAnchor(activeAnchor);
  }, [activeAnchor]);

  // Model-chosen anchors are passive range-measured overlays. They never mutate
  // draft HTML or create a native selection, so they cannot become user focus.
  useEffect(() => {
    if (!highlightAnchor || draftDocked || draftCollapsed) {
      setAnchorRects([]);
      return undefined;
    }
    const editor = draftRef.current;
    if (!editor) return undefined;
    const measure = () => setAnchorRects(measureDraftAnchorRects(editor, highlightAnchor));
    const frame = window.requestAnimationFrame(measure);
    editor.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(editor);
    return () => {
      window.cancelAnimationFrame(frame);
      editor.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [highlightAnchor, draftHtml, draftDocked, draftCollapsed]);

  // Scrolling is user-triggered: either an explicit "View passage" action or
  // reopening a collapsed/docked draft that has an active model anchor.
  useEffect(() => {
    if (!anchorRevealRequest || draftDocked || draftCollapsed) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const editor = draftRef.current;
      if (editor) scrollDraftAnchorIntoView(editor, anchorRevealRequest.anchor);
      setAnchorRevealRequest((current) => current?.id === anchorRevealRequest.id ? null : current);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchorRevealRequest, draftDocked, draftCollapsed]);

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

  function appendCoachOutput(out: TurnResult, opts?: { replaceLastCoach?: boolean; recoveryId?: number }) {
    const nextDiagnostics = [...diagnostics, ...out.diagnostics].slice(-100);
    setDiagnostics(nextDiagnostics);
    const understanding = buildDiagnosticSnapshot(out.diagnostics, stateRef.current.candidates.getAll(), stateRef.current.bank.getAll(), stateRef.current.currentUserTurn);
    const replaceLastCoach =
      Boolean(opts?.replaceLastCoach) &&
      msgs.length > 0 &&
      msgs[msgs.length - 1].role === "assistant";
    const replacedProposalId = replaceLastCoach ? msgs[msgs.length - 1].proposalId : undefined;
    if (replacedProposalId) {
      setProposals((current) => resolveProposal(current, replacedProposalId, "cancelled"));
    }
    setLastCoachDebug({
      mode: out.response?.kind ?? out.terminal?.kind ?? "idle",
      commandDebug: out.diagnostics.map((event) => ({ reason: event.code, detail: event.detail })),
    });
    if (out.recall) {
      const recalledStatus = stateRef.current.candidates.get(out.recall.candidateId)?.status;
      void recordEvent("candidate_recalled", out.recall, { outcome: "recalled", code: "candidate_recalled", ageInTurns: out.recall.ageInTurns, ...(recalledStatus ? { candidateStatus: recalledStatus } : {}) });
    }
    for (const change of out.lifecycleChanges ?? []) {
      void recordEvent("candidate_lifecycle_changed", change, { outcome: change.status, code: "candidate_memory_updated", candidateStatus: change.status });
    }

    if (out.terminal) {
      void recordEvent("application_recovery", out.terminal, { outcome: "rejected", code: out.terminal.kind });
      setMsgs((prev) => [
        ...prev.filter((message) => message.id !== opts?.recoveryId),
        { id: ++msgId, role: "application", text: out.terminal!.message, terminal: out.terminal!.kind },
      ]);
      setUnderstandingSnapshot(understanding);
      return;
    }

    if (!out.response) {
      if (opts?.recoveryId) setMsgs((prev) => prev.filter((message) => message.id !== opts.recoveryId));
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
      mode: out.response.kind === "reflection" || out.response.kind === "grounded_recap" ? "mirror" : "question",
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
      const withoutRecovery = opts?.recoveryId ? prev.filter((message) => message.id !== opts.recoveryId) : prev;
      if (replaceLastCoach && withoutRecovery.length > 0 && withoutRecovery[withoutRecovery.length - 1].role === "assistant") {
        return [...withoutRecovery.slice(0, -1), newMsg];
      }
      return [...withoutRecovery, newMsg];
    });
    setUnderstandingSnapshot(understanding);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const snapshot: PersistedSession = {
      version: 7,
      sessionId: initialSessionId,
      assistanceLevel,
      msgs: msgs.filter((message) => message.deliveryStatus !== "pending"),
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
      draftSource,
      lastSavedAt: Date.now(),
      stickyDraftFocus,
      conversation: {
        turnsSinceLastReflection: stateRef.current.turnsSinceLastReflection,
        lastAssistantText: stateRef.current.lastAssistantText,
        draft: stateRef.current.draft,
        currentUserTurn: stateRef.current.currentUserTurn,
        latestUserLanguagePattern: stateRef.current.latestUserLanguagePattern,
        currentDraftSnapshotId: stateRef.current.currentDraftSnapshotId,
        draftSnapshotText: stateRef.current.draftSnapshotText,
        legacyIgnoredCandidateIds: stateRef.current.legacyIgnoredCandidateIds,
      },
      diagnostics,
      bank: stateRef.current.bank.getAll(),
      candidates: stateRef.current.candidates.getAll(),
      map: mapStoreRef.current.snapshot(),
    };
    try {
      writePersistedSession(window.localStorage, snapshot);
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
    draftSource,
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
    if (aiAccessDenied || !mutationAccess.allows("chat_send")) return;
    const text = input.trim();
    if (!text || loading) return;
    const nonce = ++turnNonceRef.current;
    const selectedCardIds = Array.from(contextSelectedCardIds).filter((id) => {
      const card = mapStoreRef.current.get(id);
      return Boolean(card && !card.parentId && card.role !== "connection_label");
    });

    speech.stop();
    inputRef.current = "";
    setInput("");
    setError(null);
    speech.reset();
    // Consume-once: this typed message DOES use the current yellow-selected focus
    // (so "select a card, then ask about this" works), then the selection is
    // cleared so it can't silently scope the NEXT, unrelated turn. `selectedFocus`
    // is captured from this render, so clearing here doesn't affect the call below.
    setContextSelectedCardIds(new Set());
    setDraftSelectionFocus(undefined);

    const userMessage: ChatMsg = {
      id: ++msgId,
      role: "user",
      text,
      deliveryStatus: "pending",
    };
    // React state is asynchronous. Construct the provider transcript here so
    // this exact user turn is present once, in final dialogue position, on the
    // very request it triggered.
    const turnHistory = historyForCurrentTurn(buildConversationHistory(msgs), text);
    setMsgs((prev) => {
      const next = [
        ...prev.filter(
          (message) =>
            message.role !== "application" ||
            message.terminal !== "repair_failed",
        ),
        userMessage,
      ];
      msgsRef.current = next;
      return next;
    });

    setLoading(true);
    try {
      const workingState = cloneConversationState(stateRef.current);
      void recordEvent("user_message", { text });
      const requestedTools: Array<{ name: "propose_reflection_v1" | "propose_map_action_v1"; callId?: string; round: number }> = [];
      let providerResponseCount = 0;
      const out = await processTurn(
        workingState,
        text,
        makeLLM(() => configRef.current, {
          initialHistory: turnHistory,
          runtime: providerRuntime,
          onTrace: (trace) => {
            const round = providerResponseCount++;
            void recordEvent("model_request", { messages: trace.messages, model: trace.model, reasoningEffort: trace.reasoningEffort, responseId: trace.responseId }, { providerTransport: trace.transport });
            if (trace.toolName) { requestedTools.push({ name: trace.toolName, callId: trace.toolCallId, round }); void recordEvent("provider_tool_requested", { toolName: trace.toolName, callId: trace.toolCallId, providerResponse: trace.parsedProviderResponse }, { providerTransport: trace.transport, toolName: trace.toolName }); }
            void recordEvent("assistant_response", { parsedProviderResponse: trace.parsedProviderResponse, responseId: trace.responseId, outputItemTypes: trace.outputItemTypes }, { providerTransport: trace.transport, toolName: trace.toolName });
          },
        }),
        configRef.current,
        mapStoreRef.current.toLLMContext(),
        {
          mapRevision, requireConnectionLabel, selectedFocus, selectedCardIds, store: mapStoreRef.current, contract, uiLocale: locale,
          priorAssistant: [...msgs].reverse().find((message) => message.role === "assistant"),
          onProgress: (event) => { if (nonce === turnNonceRef.current) setTurnProgress(event.stage); },
        },
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
      setMsgs((previous) =>
        previous.map((message) =>
          message.id === userMessage.id
            ? { ...message, deliveryStatus: "delivered" }
            : message,
        ),
      );
      for (const event of out.diagnostics) void recordEvent("contract_decision", event, { outcome: event.outcome, code: event.code });
      appendCoachOutput(out);
    } catch (e) {
      if (nonce !== turnNonceRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      // Roll back the optimistic user bubble. It was never answered, and `msgs` is both
      // persisted and the source `buildConversationHistory` rebuilds the provider
      // transcript from — so leaving it replays a dangling, unanswered user turn into
      // every later request for the life of the saved mindmap. Restoring the text makes
      // retry one keystroke; deliberately not auto-resent, since by the time a relaunch
      // completes the message is often stale and resending spends a real call.
      const recovery = recoverFailedTurn(
        msgsRef.current,
        inputRef.current,
        userMessage,
      );
      msgsRef.current = recovery.msgs;
      setMsgs(recovery.msgs);
      if (recovery.input !== inputRef.current) {
        inputRef.current = recovery.input;
        setInput(recovery.input);
      }
      setError(msg);
    } finally {
      if (nonce === turnNonceRef.current) { setLoading(false); setTurnProgress(null); }
    }
  }

  // Runs a coach-only turn without synthetic user text. A panel request replaces
  // its prior coach move; a completed proposal appends a genuine continuation.
  async function requestMode(mode?: UserRequestedMode, proposalOutcome?: ProposalOutcomeContext, currentMapRevision = mapRevision, recoveryId?: number) {
    if (loading || aiAccessDenied) return;
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
        makeLLM(() => configRef.current, {
          initialHistory: buildConversationHistory(msgs),
          runtime: providerRuntime,
          onTrace: (trace) => {
            const round = providerResponseCount++;
            void recordEvent("model_request", { messages: trace.messages, model: trace.model, reasoningEffort: trace.reasoningEffort, responseId: trace.responseId }, { providerTransport: trace.transport });
            if (trace.toolName) { requestedTools.push({ name: trace.toolName, callId: trace.toolCallId, round }); void recordEvent("provider_tool_requested", { toolName: trace.toolName, callId: trace.toolCallId, providerResponse: trace.parsedProviderResponse }, { providerTransport: trace.transport, toolName: trace.toolName }); }
            void recordEvent("assistant_response", { parsedProviderResponse: trace.parsedProviderResponse, responseId: trace.responseId, outputItemTypes: trace.outputItemTypes }, { providerTransport: trace.transport, toolName: trace.toolName });
          },
        }),
        configRef.current,
        mapStoreRef.current.toLLMContext(),
        {
          mapRevision: currentMapRevision, requireConnectionLabel, selectedFocus, requestedSupport: mode, proposalOutcome, uiLocale: locale,
          store: mapStoreRef.current, contract,
          priorAssistant: [...msgs].reverse().find((message) => message.role === "assistant"),
          onProgress: (event) => { if (nonce === turnNonceRef.current) setTurnProgress(event.stage); },
        },
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
      appendCoachOutput(out, { replaceLastCoach: Boolean(mode), recoveryId });
    } catch (e) {
      if (nonce !== turnNonceRef.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      if (nonce === turnNonceRef.current) { setLoading(false); setTurnProgress(null); }
    }
  }

  function retryRecovery(recoveryId: number) {
    if (!mutationAccess.allows("recovery_retry")) return;
    if (loading) return;
    void requestMode(undefined, undefined, mapRevision, recoveryId);
  }

  async function decideClaim(proposalId: string, claimId: string, decision: "confirmed" | "declined") {
    if (!mutationAccess.allows("reflection_resolve")) return;
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
        const applied = applyConfirmedReflection(confirmedReflection, mapStoreRef.current);
        setConfirmed((prev) => [...prev, confirmedReflection]);
        if (stateRef.current.candidates.transition(confirmedReflection.candidateId, "promoted", stateRef.current.currentUserTurn)) {
          void recordEvent("candidate_lifecycle_changed", { candidateId: confirmedReflection.candidateId, status: "promoted", turn: stateRef.current.currentUserTurn }, { outcome: "promoted", candidateStatus: "promoted" });
          setUnderstandingSnapshot((prev) => prev ? { ...prev, trackedIdeas: prev.trackedIdeas.filter((idea) => idea.id !== confirmedReflection.candidateId), ignoredIdeas: (prev.ignoredIdeas ?? []).filter((idea) => idea.id !== confirmedReflection.candidateId) } : prev);
        }
        markUserMapChanged(applied.status === "applied" && applied.cardId ? [applied.cardId] : []);
        const event: DiagnosticEvent = { id: `d_${Date.now()}`, at: Date.now(), stage: "application", outcome: "applied", code: "reflection_claim_applied", detail: "Confirmed reflection claim passed the gateway and was added to the map." };
        setDiagnostics((current) => [...current, event].slice(-100));
        void recordEvent("map_mutated", { proposalId, claimId }, { origin: proposal.origin, outcome: "applied" });
      } else {
        captureMapUndo();
        const ids = [stateRef.current.bank.add(appliedText, "declaration").id];
        const action: ProposedAction = { kind: "create_card", text: appliedText, sourceUtteranceIds: ids };
        const checked = inspectAction(action, { actor: "user_canvas", store: mapStoreRef.current, bank: stateRef.current.bank });
        if (checked.status === "ready") {
          const changedUnits = applyGatewayActions([checked.action], mapStoreRef.current, stateRef.current.bank);
          setConfirmed((prev) => [...prev, { ...confirmedReflection, sourceUtteranceIds: ids }]);
          if (stateRef.current.candidates.transition(confirmedReflection.candidateId, "promoted", stateRef.current.currentUserTurn)) {
            void recordEvent("candidate_lifecycle_changed", { candidateId: confirmedReflection.candidateId, status: "promoted", turn: stateRef.current.currentUserTurn }, { outcome: "promoted", candidateStatus: "promoted" });
            setUnderstandingSnapshot((prev) => prev ? { ...prev, trackedIdeas: prev.trackedIdeas.filter((idea) => idea.id !== confirmedReflection.candidateId), ignoredIdeas: (prev.ignoredIdeas ?? []).filter((idea) => idea.id !== confirmedReflection.candidateId) } : prev);
          }
          markUserMapChanged(changedUnits.filter((unit) => unit.role !== "connection_label").map((unit) => unit.id));
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
    if (!mutationAccess.allows("proposal_edit")) return;
    setProposals((current) => {
      const proposal = current.get(proposalId);
      if (!proposal || proposal.detail.kind !== "reflection" || proposal.detail.decisions[claimId] !== "pending") return current;
      return updateProposal(current, proposalId, { state: "edited", detail: { ...proposal.detail, editedTexts: { ...proposal.detail.editedTexts, [claimId]: text } } });
    });
  }

  function addComposerAsCard() {
    if (!mutationAccess.allows("add_as_card")) return;
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
      { id: userId, role: "user", text },
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
    requestDraftAnchorReveal(anchor);
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
      requestDraftAnchorReveal(highlightAnchor);
      return;
    }
    setDraftDocked(true);
    setDraftCollapsed(true);
  }

  function clearMapOnly() {
    if (!mutationAccess.allows("map_clear")) return;
    reader.clearDisplayCache();
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
    if (!mutationAccess.allows("draft_clear")) return;
    reader.clearDisplayCache();
    turnNonceRef.current++;
    setLoading(false);
    setDraftText("");
    setDraftHtml("");
    setHighlightAnchor(undefined);
    setDraftSelectionFocus(undefined);
    setStickyDraftFocus(undefined);
    setDraftSource(undefined);
    stateRef.current.draft = "";
  }

  function clearChatOnly() {
    if (!mutationAccess.allows("chat_clear")) return;
    reader.clearDisplayCache();
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
    <>
      <style>{css}</style>
      <div className="layout">
        {/* Chat panel */}
        <div className="chat-panel">
          <div className="chat-header">
            <div className="chat-header-actions chat-header-actions-left">
              <button className="reset-btn" disabled={readOnly} onClick={clearChatOnly} title={readOnly ? t("Switch back to the original view to edit.") : t("Clear the chat conversation only")} aria-describedby={readOnly ? "reader-view-status" : undefined}>
                {t("Clear chat")}
              </button>
            </div>
            <label className="question-bias chat-question-bias">
              <span>{t("Think")}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={25}
                list="question-bias-ticks"
                value={questionBias}
                aria-label={t("Question framing bias")}
                disabled={readOnly}
                onChange={(event) => mutationAccess.run("assistance_change", () => setQuestionBias(Number(event.target.value)))}
              />
              <datalist id="question-bias-ticks">
                <option value="0" />
                <option value="25" />
                <option value="50" />
                <option value="75" />
                <option value="100" />
              </datalist>
              <span>{t("Map")}</span>
            </label>
            <label className="assistance-contract">
              <span>{t("Help")}</span>
              <select
                aria-label={t("Assistance level")}
                value={assistanceLevel}
                disabled={readOnly}
                onChange={(event) => {
                  if (!mutationAccess.allows("assistance_change")) return;
                  const next = Number(event.target.value) as AssistanceLevel;
                  setAssistanceLevel(next);
                  void recordEvent("contract_changed", { from: assistanceLevel, to: next }, { contract: snapshotContract(contractForLevel(next)) });
                }}
              >
                {([0, 1, 2] as AssistanceLevel[]).map((level) => (
                  <option key={level} value={level}>{t(ASSISTANCE_CONTRACTS[level].label)}</option>
                ))}
              </select>
            </label>
          </div>

          {!ledgerAvailable && <div className="error-banner">{t("Local audit storage is unavailable in this browser.")}</div>}
          {reader.isTranslatedView && (
            <div id="reader-view-status" className="reader-status-banner" role="status">
              {t("Viewing a translation. Switch back to the original view to edit.")}
              <button type="button" onClick={reader.returnToOriginal}>{t("Back to original")}</button>
              {reader.rejection && (
                <div key={reader.rejection.id} className="reader-rejection" role="alert">
                  {t("Switch back to the original view to edit.")}
                </div>
              )}
            </div>
          )}

          <div className="messages">
            {msgs.map((m) => (
              <div key={m.id} className={`msg ${m.role} ${m.mode ?? ""}`}>
                <span className="msg-label">
                  {m.role === "user" ? t("you") : m.role === "assistant" ? t("coach") : t("recovery")}
                  {m.role === "assistant" && <AssistantResponseKindBadge kind={m.responseKind} />}
                  {m.questionStance && (
                    <span className={`stance-chip stance-${m.questionStance}`}>{t(m.questionStance)}</span>
                  )}
                </span>
                <div className="msg-bubble">
                  {m.role === "application" && m.terminal === "repair_failed" ? t(m.text) : reader.translate(m.text)}
                </div>
                {m.role === "application" && m.terminal === "repair_failed" && (
                  <div className="recovery-actions">
                    <button type="button" className="btn btn-confirm-sm" onClick={() => retryRecovery(m.id)} disabled={readOnly || loading}>{t("Try again")}</button>
                  </div>
                )}
                {m.role === "user" && m.deliveryStatus === "failed" && (
                  <div className="recovery-actions">
                    <button
                      type="button"
                      className="btn btn-confirm-sm"
                      onClick={() => {
                        const restored = restoreFailedMessageToComposer(
                          msgsRef.current,
                          inputRef.current,
                          m.id,
                        );
                        msgsRef.current = restored.msgs;
                        inputRef.current = restored.input;
                        setMsgs(restored.msgs);
                        setInput(restored.input);
                      }}
                    >
                      {t("Restore to composer")}
                    </button>
                  </div>
                )}
                {m.role === "assistant" && m.questionAnchor && (
                  <button className="anchor-view-btn" type="button" onClick={() => revealDraftAnchor(m.questionAnchor!)}>
                    {t("View passage")}
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
            {loading && (turnProgress || showWorking) && (
              <div className="msg assistant">
                <span className="msg-label">{t("coach")}</span>
                <div className="msg-bubble" style={{ color: "#aaa", fontStyle: "italic" }}>
                  {t(turnProgress ? TURN_PROGRESS_COPY[turnProgress] : "Working...")}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            {aiAccessDenied && <div className="error-banner" role="alert">{t("This account is not permitted to use AI features. Your draft and map remain available.")}</div>}
            {error && <div className="error-banner">{error}</div>}
            {stickyDraftFocus && (
              <div className="focus-chip" role="status">
                <span className="focus-chip-text">{t("Focusing on selected text:")} “{reader.translate(focusSummary(stickyDraftFocus.text))}”</span>
                <button className="focus-chip-dismiss" type="button" onClick={() => setStickyDraftFocus(undefined)} aria-label={t("Stop focusing on selected text")}>×</button>
              </div>
            )}
            <div className="input-row">
              <textarea
                ref={textareaRef}
                className={`composer-textarea ${composerScrollable ? "composer-scroll" : ""}`}
                rows={2}
                placeholder={t("Say what's on your mind…")}
                value={input}
                onChange={(e) => {
                  if (mutationAccess.allows("chat_send")) setInput(e.target.value);
                }}
                onKeyDown={onKey}
                disabled={readOnly || loading}
                aria-describedby={readOnly ? "reader-view-status" : undefined}
              />
              <div className="composer-toolbar">
                <div className="composer-left-tools">
                  <button
                    className={`uth-toggle-btn ${underhoodOpen ? "active" : ""}`}
                    type="button"
                    title={underhoodOpen ? t("Close Control Room") : t("Open Control Room")}
                    aria-label={underhoodOpen ? t("Close Control Room panel") : t("Open Control Room panel")}
                    aria-pressed={underhoodOpen}
                    onClick={() => setUnderhoodOpen((value) => !value)}
                  >
                    <UnderhoodIcon />
                    <span>{t("Control Room")}</span>
                  </button>
                  <button
                    className="draft-toggle-btn"
                    type="button"
                    title={draftDocked ? t("Open draft") : t("Dock draft")}
                    aria-label={draftDocked ? t("Open draft") : t("Dock draft")}
                    onClick={toggleDraftFromComposer}
                  >
                    {t("Draft")}
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
                    title={readOnly ? t("Switch back to the original view to edit.") : "Create a confirmable card from this wording"}
                    onClick={addComposerAsCard}
                    disabled={readOnly || loading || !input.trim()}
                    aria-describedby={readOnly ? "reader-view-status" : undefined}
                  >
                    {t("Add as card")}
                  </button>
                  <button
                    className={`mic-btn ${speech.listening ? "live" : ""}`}
                    type="button"
                    title={
                      speech.supported
                        ? speech.listening
                          ? t("Stop voice dictation")
                          : t("Start voice dictation")
                        : t("Voice dictation is unavailable in this browser")
                    }
                    aria-label={
                      speech.supported
                        ? speech.listening
                          ? t("Stop voice dictation")
                          : t("Start voice dictation")
                        : t("Voice dictation is unavailable in this browser")
                    }
                    aria-pressed={speech.listening}
                    disabled={readOnly || !speech.supported || loading}
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
                  <button className="send-btn" onClick={() => void send()} disabled={readOnly || aiAccessDenied || loading || !input.trim()} aria-label={t("Send")} title={readOnly ? t("Switch back to the original view to edit.") : undefined} aria-describedby={readOnly ? "reader-view-status" : undefined}>
                    {"\u2191"}
                  </button>
                </div>
              </div>
            </div>
            <div className="input-hint">{t("Enter to send")} {"\u00b7"} {t("Shift+Enter for newline")}</div>
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
            title={t("Open draft - drag to move, click to expand")}
          >
            <span className="draft-chip-label">{t("DRAFT")}</span>
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
        >
          <div className="draft-panel-header" onMouseDown={onDragStart}>
            <span className="draft-panel-title">{t("Draft")}</span>
            {draftSource && (
              <span className="draft-source-label">
                {interpolateUi(
                  t("Snapshot of {document} captured at launch. Edits here do not sync back."),
                  { document: draftSource.documentLabel },
                )}
              </span>
            )}
            <button
              className="draft-panel-btn"
              type="button"
              onClick={() => setDraftDocked(true)}
              title={t("Dock the draft into the map toolbar")}
            >
              {t("Dock")}
            </button>
            <button
              className="draft-panel-btn draft-panel-btn-icon"
              type="button"
              onClick={() => {
                const back = preExpandChipPosRef.current;
                if (back) setDraftPos(clampBoxPosition(back, DRAFT_CHIP_WIDTH, DRAFT_CHIP_HEIGHT));
                setDraftCollapsed(true);
              }}
              aria-label={t("Collapse draft")}
              title={t("Collapse to icon")}
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
                <div className="draft-anchor-overlay" aria-hidden="true">
                  {anchorRects.map((rect, index) => (
                    <span
                      className="draft-anchor-mark"
                      key={`${rect.left}:${rect.top}:${index}`}
                      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                    />
                  ))}
                </div>
                {reader.isTranslatedView ? (
                  <div className="draft-editor" role="textbox" aria-readonly="true">{reader.translate(draftText)}</div>
                ) : (
                  <div
                    ref={draftRef}
                    className="draft-editor"
                    contentEditable={!readOnly}
                    suppressContentEditableWarning
                    role="textbox"
                    aria-multiline="true"
                    data-placeholder={t("Paste or type your draft here...")}
                    onMouseDown={() => setHighlightAnchor(undefined)}
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
            draftDockSlot={
              <div className={`map-draft-slot ${draftDocked ? "occupied" : "empty"}`}>
                {draftDocked ? (
                <button
                  type="button"
                  className="map-draft-dock"
                  onMouseDown={onDockedDraftMouseDown}
                  title={t("Click to open draft, or drag out to undock")}
                >
                  <span className="map-draft-dock-label">{t("DRAFT")}</span>
                  {highlightAnchor && <span className="map-draft-dock-dot" aria-hidden="true" />}
                </button>
                ) : (
                  <span className="map-draft-slot-label">{t("Draft")}</span>
                )}
              </div>
            }
            draftDockActive={draftDockTargetActive}
            highlightedCardIds={referencedCardIds}
            contextSelectedCardIds={contextSelectedCardIds}
            revision={mapRevision}
            requireConnectionLabel={requireConnectionLabel}
            onRequireConnectionLabelChange={changeConnectionSetting}
            canUndo={canUndoMap}
            onUndo={undoMapChange}
            onClearDraft={clearDraftOnly}
            onClearMap={clearMapOnly}
            onContextCardToggle={toggleContextCard}
            onClearContextSelection={clearContextSelection}
            onBeforeMapChange={captureUserMapUndo}
            onStoreChange={markUserMapChanged}
          />
          <UnderTheHoodPanel
            snapshot={understandingSnapshot}
            onDraftAnchor={revealDraftAnchor}
            onRequestMode={(mode) => {
              if (mutationAccess.allows("conversation_continue")) void requestMode(mode);
            }}
            onDismissIdea={dismissTrackedIdea}
            onRestoreIdea={restoreTrackedIdea}
            busy={loading}
            open={underhoodOpen}
            onOpenChange={setUnderhoodOpen}
            provenance={provenanceTotals(mapStoreRef.current.getAll(), mapStoreRef.current.getConnections())}
          />
        </div>
      </div>
    </>
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
  // Echo is an influence signal, not an authorship claim — this trace also
  // rides user-authored proposals, so it must never say "AI-suggested". When
  // the ratio rounds to 0% we drop the count instead of showing a bare "· 0%".
  return (
    <span
      className="influence-badge"
      title={`This wording echoes your coach's previous message: "${influence.exactOverlapPhrases.join('", "')}"`}
    >
      Echoes coach{pct ? ` · ${pct}%` : ""}
    </span>
  );
}

export function AssistantResponseKindBadge({ kind }: { kind?: AssistantResponse["kind"] }) {
  const { t } = useUiLocale();
  if (kind === "suggestion") return <span className="ai-suggestion-badge">{t("AI suggestion")}</span>;
  if (kind === "translation") return <span className="ai-translation-badge">{t("AI-translated")}</span>;
  if (kind === "grounded_recap") return <span className="stance-chip">{t("recap from your words")}</span>;
  return null;
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
  return <ReflectionProposalCard proposal={proposal} reflection={proposal.detail} onDecide={onDecide} onEdit={onEdit} />;
}

function ReflectionProposalCard({
  proposal,
  reflection,
  onDecide,
  onEdit,
}: {
  proposal: Proposal;
  reflection: Extract<Proposal["detail"], { kind: "reflection" }>;
  onDecide: (claimId: string, decision: "confirmed" | "declined") => void;
  onEdit: (claimId: string, text: string) => void;
}) {
  const { t } = useUiLocale();
  const reader = useReaderView();
  const readOnly = useMutationAccess().mode === "translated_view";
  useEffect(() => {
    reader.prefetch([proposal.invalidReason ?? "", ...reflection.reflection.claims.map((claim) => reflection.editedTexts[claim.id] ?? claim.text)]);
  }, [proposal.invalidReason, reader.prefetch, reflection]);
  if (proposal.state === "invalidated") return <div className="mirror-card"><span className="mirror-card-label">{t("This proposal is no longer valid:")} {reader.translate(proposal.invalidReason ?? "")}</span></div>;
  if (proposal.state === "confirmed" || proposal.state === "declined" || proposal.state === "cancelled") return null;
  return (
    <div className="mirror-card">
      <div className="mirror-card-head">
        <span className="mirror-card-label">{t("Here's the structure in your words — edit if needed, then confirm")}</span>
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
                  value={readOnly ? reader.translate(text) : text}
                  readOnly={readOnly}
                  rows={Math.max(5, Math.min(10, text.split(/\n/).length + Math.ceil(text.length / 42)))}
                  onChange={(event) => onEdit(claim.id, event.target.value)}
                  aria-label={`Editable mirrored wording ${claimNumber}`}
                />
              ) : (
                <span className="claim-text">{reader.translate(text)}</span>
              )}
              {decision === "pending" ? (
                <div className="claim-btns">
                  <button
                    className="btn btn-confirm-sm"
                    disabled={readOnly || !text.trim()}
                    onClick={() => onDecide(claim.id, "confirmed")}
                    aria-label={`Confirm mirrored wording ${claimNumber}`}
                  >
                    {t("Yes")}
                  </button>
                  <button
                    className="btn btn-decline-sm"
                    disabled={readOnly}
                    onClick={() => onDecide(claim.id, "declined")}
                    aria-label={`Reject mirrored wording ${claimNumber}`}
                  >
                    {t("Not quite")}
                  </button>
                </div>
              ) : (
                <span className={`claim-badge ${decision}`}>
                  {decision === "confirmed" ? t("confirmed") : t("not quite")}
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
  return <MapActionProposalContent proposal={proposal} detail={proposal.detail} cards={cards} onEdit={onEdit} onDecide={onDecide} />;
}

function MapActionProposalContent({
  proposal,
  detail,
  cards,
  onEdit,
  onDecide,
}: {
  proposal: Proposal;
  detail: Extract<Proposal["detail"], { kind: "map_action" }>;
  cards: ThoughtUnit[];
  onEdit: (id: string, action: ProposedAction) => void;
  onDecide: (id: string, decision: "confirmed" | "declined") => void;
}) {
  const { t } = useUiLocale();
  const reader = useReaderView();
  const readOnly = useMutationAccess().mode === "translated_view";
  const { action } = detail;
  const completion = detail.completion;
  useEffect(() => {
    const actionText = action.kind === "create_card" || action.kind === "edit_card" ? [action.text] : action.kind === "connect_cards" ? [action.labelText ?? "", ...(completion?.kind === "relationship_label" ? completion.options.map((option) => option.text) : [])] : [];
    reader.prefetch([proposal.invalidReason ?? "", ...cards.map((card) => card.text), ...actionText]);
  }, [action, cards, completion, proposal.invalidReason, reader.prefetch]);
  if (proposal.state === "confirmed" || proposal.state === "declined" || proposal.state === "cancelled") return null;
  if (proposal.state === "invalidated") {
    return <div className="mirror-card"><span className="mirror-card-label">{t("This proposal is no longer valid:")} {reader.translate(proposal.invalidReason ?? "")}</span></div>;
  }
  const visibleCards = completion?.kind === "reference_choice"
    ? cards.filter((card) => completion.candidates.some((candidate) => candidate.id === card.id))
    : cards;
  const cardOptions = (
    <option value="">{t("Choose an existing card…")}</option>
  );
  const selectRef = (
    value: string | undefined,
    onChange: (id: string) => void,
    label: string,
  ) => (
    <label className="claim-row">
      <span className="claim-text">{label}</span>
      <select disabled={readOnly} value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
        {cardOptions}
        {visibleCards.map((card) => <option key={card.id} value={card.id}>{reader.translate(card.text) || t("Untitled card")}</option>)}
      </select>
    </label>
  );
  const renderEditor = () => {
    if (action.kind === "create_card") {
      return <textarea className="claim-text claim-editor" readOnly={readOnly} value={readOnly ? reader.translate(action.text) : action.text} rows={3} onChange={(event) => onEdit(proposal.id, { ...action, text: event.target.value })} />;
    }
    if (action.kind === "edit_card") {
      return <textarea className="claim-text claim-editor" readOnly={readOnly} value={readOnly ? reader.translate(action.text) : action.text} rows={3} onChange={(event) => onEdit(proposal.id, { ...action, text: event.target.value })} />;
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
      <textarea className="claim-text claim-editor" readOnly={readOnly} value={readOnly ? reader.translate(action.labelText ?? "") : action.labelText ?? ""} placeholder={t("Relationship wording")} rows={2} onChange={(event) => onEdit(proposal.id, { ...action, labelText: event.target.value, labelOrigin: action.labelOrigin === "ai_suggested" ? "ai_suggested" : "user_asserted" })} />
      {completion?.kind === "relationship_label" && completion.options.length > 0 && (
        <div className="claim-btns">
          {completion.options.map((option, index) => <button key={`${option.text}-${index}`} disabled={readOnly} className="btn btn-decline-sm" onClick={() => onEdit(proposal.id, { ...action, labelText: option.text, labelSourceUtteranceIds: option.sourceUtteranceIds, labelOrigin: option.origin })}>{option.origin === "ai_suggested" ? `${t("AI suggestion")}: ${reader.translate(option.text)}` : reader.translate(option.text)}</button>)}
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
        <span className="mirror-card-label">{proposal.origin === "ai_suggested" ? t("AI suggestion — review before adding") : t("Review this map change")}</span>
        <InfluenceBadge influence={proposal.influenceTrace} />
      </div>
      {renderEditor()}
      <div className="claim-btns">
        <button className="btn btn-confirm-sm" disabled={readOnly || !complete} onClick={() => onDecide(proposal.id, "confirmed")}>{t("Confirm")}</button>
        <button className="btn btn-decline-sm" disabled={readOnly} onClick={() => onDecide(proposal.id, "declined")}>{t("Dismiss")}</button>
      </div>
    </div>
  );
}
