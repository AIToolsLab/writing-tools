/**
 * The persisted mindmap session: its shape, its storage key, and the read/write/clear
 * operations over `localStorage`.
 *
 * Split out of `App.tsx` (item 7, slice 2). The launcher integration made the split
 * necessary rather than merely tidy: `PlatformBootstrap` has to ask "is there real
 * saved work?" *before* it mounts `App`, in order to decide between continuing a saved
 * mindmap and starting fresh from a handed-off document. Importing that predicate from
 * the component it is about to render made the boot layer depend on a 4,600-line module
 * for two lines of storage logic.
 *
 * This module owns the persisted *shape*. It deliberately does not own the migrations
 * that transform loaded data into live stores (`migrateLegacyMirrors`,
 * `migrateStoredProposals`, `migrateCandidateMemory` stay in `App.tsx`) — those operate
 * on the running `ThoughtUnitStore` / bank, not on storage.
 */
import type { AssistanceLevel } from "./assistance-contract";
import type { AssistantResponse, ConversationState, DiagnosticEvent, RepairFailureTerminal } from "./assistant-response";
import type { QuestionStance } from "./llm-contract";
import type { CoachDebugInfo } from "./Map";
import type { ThoughtUnitStoreSnapshot } from "./map-store";
import type { Proposal } from "./proposal-store";
import type { ClaimValidation, ConfirmedReflection, MirrorReflection } from "./types";
import type { UnderstandingSnapshot } from "./understanding";

/** Unchanged since v1 despite the schema reaching version 7 — renaming it would strand
 *  every existing session. The version lives in the payload, not the key. */
export const SESSION_STORAGE_KEY = "prototype-mindmap-session-v1";
export const SUPPORTED_SESSION_VERSIONS = [1, 2, 3, 4, 5, 6, 7] as const;
export type PersistedSessionVersion = (typeof SUPPORTED_SESSION_VERSIONS)[number];

export interface ChatMsg {
  id: number;
  role: "user" | "assistant" | "application";
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
  /** Application-owned terminal recovery; never sent to the model as dialogue. */
  terminal?: RepairFailureTerminal["kind"];
  /** Missing means delivered for sessions written before optimistic-state tracking. */
  deliveryStatus?: "pending" | "delivered" | "failed";
}

export interface DraftPanelPos { x: number; y: number; }
export interface DraftPanelSize { w: number; h: number; }
export interface DraftSelectionFocus { text: string; }

export type ClaimDecision = "pending" | "confirmed" | "declined";

export interface PersistedPendingMirror {
  id: string;
  reflection: MirrorReflection;
  claims: ClaimValidation[];
  decisions: Record<string, ClaimDecision>;
  editedTexts?: Record<string, string>;
}

/** Where the draft came from, when it was handed over by the launcher rather than
 *  typed here. Drives the "snapshot captured at launch" label and names the saved
 *  session on the relaunch choice screen. */
export interface DraftSourceMetadata {
  kind: "launch_snapshot";
  documentLabel: string;
  capturedAt: number;
}

export interface PersistedSession {
  version: PersistedSessionVersion;
  sessionId?: string;
  assistanceLevel?: AssistanceLevel;
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
  draftSource?: DraftSourceMetadata;
  lastSavedAt?: number;
  stickyDraftFocus?: DraftSelectionFocus;
  conversation?: {
    turnsSinceLastReflection: number;
    lastAssistantText: string;
    draft: string;
    currentUserTurn?: number;
    latestUserLanguagePattern?: "single" | "mixed" | "unknown";
    currentDraftSnapshotId?: string;
    draftSnapshotText?: string;
    legacyIgnoredCandidateIds?: string[];
    /** v1-v5 migration input only. */
    dismissedCandidateIds?: string[];
  };
  /** Read only by the v1/v2 migration and never restored into live routing state. */
  controller?: { turnsSinceLastMirror?: number; lastAiText?: string; draft?: string; dismissedCandidateIds?: string[] };
  diagnostics?: DiagnosticEvent[];
  bank: ReturnType<ConversationState["bank"]["getAll"]>;
  candidates: ReturnType<ConversationState["candidates"]["getAll"]>;
  map: ThoughtUnitStoreSnapshot;
}

/** What the relaunch choice screen needs to name a saved mindmap, without loading it. */
export interface SavedMindmapSummary {
  documentLabel: string;
  lastSavedAt?: number;
}

const SUPPORTED_VERSIONS: ReadonlySet<number> = new Set(SUPPORTED_SESSION_VERSIONS);

export function hasPersistableWork(
  session: Pick<PersistedSession, "msgs" | "draftText" | "map">,
): boolean {
  const hasMessages =
    Array.isArray(session.msgs) &&
    session.msgs.some((message) => message.deliveryStatus !== "pending");
  const hasDraft =
    typeof session.draftText === "string" && session.draftText.trim().length > 0;
  const hasMap =
    session.map !== null &&
    typeof session.map === "object" &&
    ((Array.isArray(session.map.units) && session.map.units.length > 0) ||
      (Array.isArray(session.map.connections) && session.map.connections.length > 0));
  return hasMessages || hasDraft || hasMap;
}

export function loadPersistedSession(storage?: Pick<Storage, "getItem">): PersistedSession | null {
  const source = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!source) return null;
  try {
    const raw = source.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    return SUPPORTED_VERSIONS.has(parsed.version) && hasPersistableWork(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function writePersistedSession(
  storage: Pick<Storage, "setItem" | "removeItem">,
  session: PersistedSession,
): void {
  const persistable = {
    ...session,
    msgs: session.msgs.filter((message) => message.deliveryStatus !== "pending"),
  };
  if (!hasPersistableWork(persistable)) {
    storage.removeItem(SESSION_STORAGE_KEY);
    return;
  }
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(persistable));
}

/**
 * Summarize a saved session, or null when there is nothing worth offering to continue.
 *
 * The emptiness check is load-bearing, not cosmetic. `App`'s persist effect runs on
 * mount, so a session row exists the instant the app renders — without this guard every
 * relaunch after the first would present a "Continue" option pointing at an untouched
 * shell, and choosing it would silently discard the document the user just shared.
 */
export function savedMindmapSummary(storage: Pick<Storage, "getItem">): SavedMindmapSummary | null {
  const saved = loadPersistedSession(storage);
  if (!saved) return null;
  return {
    documentLabel: saved.draftSource?.documentLabel || "Saved mindmap",
    lastSavedAt: saved.lastSavedAt,
  };
}

/** Discard the saved mindmap. Only ever called for an explicit "start new" choice —
 *  never on token expiry, and never from an error path. */
export function clearSavedMindmap(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(SESSION_STORAGE_KEY);
}
