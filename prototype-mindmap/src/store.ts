/**
 * In-memory stores for M1 loop.
 *
 * SourceBank: append-only record of every user utterance (ground truth).
 * CandidateStore: LLM-maintained working hypotheses, never shown raw to the user.
 */

import { segment } from "./normalize";
import type {
  CandidateThought,
  CandidateStatus,
  SourceUtterance,
  UtteranceOrigin,
} from "./types";

let _nextId = 0;
let _nextTurn = 0;
let _nextDraftSnapshot = 0;
export function nextId(prefix: string): string {
  return `${prefix}_${++_nextId}`;
}
/** Reset counters — call between tests to keep ids deterministic. */
export function resetIdCounter(): void {
  _nextId = 0;
  _nextTurn = 0;
  _nextDraftSnapshot = 0;
}

function trailingNumber(value: string | undefined): number {
  if (!value) return 0;
  const match = value.match(/_(\d+)$/);
  return match ? Number(match[1]) : 0;
}

/**
 * Human-facing card reference (e.g. "#3"), derived from the id's trailing
 * counter. The counter is globally unique and monotonic, so the number is a
 * stable, collision-free handle the user and the AI can both cite in chat.
 */
export function cardRef(id: string): string {
  return `#${trailingNumber(id)}`;
}

export function primeIdCounters(ids: string[], turnIds: string[] = []): void {
  for (const id of ids) {
    _nextId = Math.max(_nextId, trailingNumber(id));
  }
  for (const turnId of turnIds) {
    _nextTurn = Math.max(_nextTurn, trailingNumber(turnId));
  }
}

export class SourceBank {
  private _utterances: Map<string, SourceUtterance> = new Map();

  add(text: string, origin: UtteranceOrigin = "chat"): SourceUtterance {
    const u: SourceUtterance = {
      id: nextId("u"),
      text,
      timestamp: Date.now(),
      origin,
    };
    this._utterances.set(u.id, u);
    return u;
  }

  /**
   * Segment a block of input into sentence-level units sharing one turnId, and
   * record each as its own utterance. Returns the units in order. A block with
   * no sentence boundary becomes a single unit.
   */
  addSegmented(
    text: string,
    origin: UtteranceOrigin = "chat",
  ): SourceUtterance[] {
    const turnId = `t_${++_nextTurn}`;
    const parts = segment(text);
    const pieces = parts.length > 0 ? parts : [text.trim()].filter(Boolean);
    const now = Date.now();
    return pieces.map((piece) => {
      const u: SourceUtterance = {
        id: nextId("u"),
        text: piece,
        timestamp: now,
        origin,
        turnId,
      };
      this._utterances.set(u.id, u);
      return u;
    });
  }

  /** Capture draft wording as immutable, sentence-level evidence. */
  addDraftSnapshot(text: string): { snapshotId: string; utterances: SourceUtterance[] } {
    const snapshotId = `draft_${++_nextDraftSnapshot}`;
    const parts = segment(text);
    const pieces = parts.length > 0 ? parts : [text.trim()].filter(Boolean);
    const now = Date.now();
    const utterances = pieces.map((piece) => {
      const utterance: SourceUtterance = { id: nextId("u"), text: piece, timestamp: now, origin: "draft", draftSnapshotId: snapshotId };
      this._utterances.set(utterance.id, utterance);
      return utterance;
    });
    return { snapshotId, utterances };
  }

  get(id: string): SourceUtterance | undefined {
    return this._utterances.get(id);
  }

  getAll(): SourceUtterance[] {
    return Array.from(this._utterances.values());
  }

  markCommandOnly(ids: Iterable<string>): void {
    for (const id of ids) {
      const utterance = this._utterances.get(id);
      if (!utterance || utterance.commandOnly) continue;
      this._utterances.set(id, {
        ...utterance,
        commandOnly: true,
      });
    }
  }

  /** Mark utterances as conversational asides — kept, but not writing material. */
  markNonHarvestable(ids: Iterable<string>): void {
    for (const id of ids) {
      const utterance = this._utterances.get(id);
      if (!utterance || utterance.nonHarvestable) continue;
      this._utterances.set(id, {
        ...utterance,
        nonHarvestable: true,
      });
    }
  }

  replaceAll(utterances: SourceUtterance[]): void {
    this._utterances = new Map(utterances.map((u) => [u.id, u]));
    primeIdCounters(
      utterances.map((u) => u.id),
      utterances.map((u) => u.turnId ?? ""),
    );
  }
}

export class CandidateStore {
  private _candidates: Map<string, CandidateThought> = new Map();
  private _legacyIgnoredIds: Set<string> = new Set();

  private signature(candidate: Pick<CandidateThought, "target" | "evidenceUtteranceIds">): string {
    return `${candidate.target}:${Array.from(new Set(candidate.evidenceUtteranceIds)).sort().join(",")}`;
  }

  upsert(candidate: CandidateThought): "created" | "updated" | "blocked_id" | "blocked_tombstone" | "blocked_status" | "target_mismatch" {
    if (this._legacyIgnoredIds.has(candidate.id)) return "blocked_id";
    const existing = this._candidates.get(candidate.id);
    if (existing) {
      if (existing.status === "ignored" || existing.status === "promoted") return "blocked_status";
      if (existing.target !== candidate.target) return "target_mismatch";
      // Merge evidence rather than replace it, so no turn's grounding is
      // silently lost on an update.
      const mergedEvidence = Array.from(
        new Set([
          ...existing.evidenceUtteranceIds,
          ...candidate.evidenceUtteranceIds,
        ]),
      );
      this._candidates.set(candidate.id, {
        ...existing,
        ...candidate,
        createdTurn: existing.createdTurn,
        evidenceUtteranceIds: mergedEvidence,
      });
      return "updated";
    } else {
      const signature = this.signature(candidate);
      if (this.getAll().some((item) => item.status === "ignored" && this.signature(item) === signature)) return "blocked_tombstone";
      this._candidates.set(candidate.id, candidate);
      return "created";
    }
  }

  transition(id: string, status: Extract<CandidateStatus, "ignored" | "parked" | "promoted">, turn: number): boolean {
    const candidate = this._candidates.get(id);
    if (!candidate) return false;
    if (status === "parked" && candidate.status !== "ignored") return false;
    if (status === "ignored" && candidate.status !== "active" && candidate.status !== "parked") return false;
    if (status === "promoted" && candidate.status === "promoted") return false;
    this._candidates.set(id, {
      ...candidate,
      status,
      lastTouchedTurn: turn,
      ...(status === "ignored" ? { ignoredAtTurn: turn } : { ignoredAtTurn: undefined }),
      ...(status === "promoted" ? { promotedAtTurn: turn } : {}),
    });
    return true;
  }

  markRecalled(id: string, turn: number): boolean {
    const candidate = this._candidates.get(id);
    if (!candidate || (candidate.status !== "active" && candidate.status !== "parked")) return false;
    this._candidates.set(id, { ...candidate, lastTouchedTurn: turn, lastRecalledTurn: turn });
    return true;
  }

  ageInTurns(id: string, currentTurn: number): number | undefined {
    const candidate = this._candidates.get(id);
    return candidate ? Math.max(0, currentTurn - candidate.lastTouchedTurn) : undefined;
  }

  get(id: string): CandidateThought | undefined {
    return this._candidates.get(id);
  }

  getAll(): CandidateThought[] {
    return Array.from(this._candidates.values());
  }

  replaceAll(candidates: CandidateThought[]): void {
    this._candidates = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  }

  setLegacyIgnoredIds(ids: string[]): void {
    this._legacyIgnoredIds = new Set(ids);
  }

  getLegacyIgnoredIds(): string[] {
    return Array.from(this._legacyIgnoredIds);
  }
}
