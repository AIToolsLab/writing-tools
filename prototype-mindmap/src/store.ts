/**
 * In-memory stores for M1 loop.
 *
 * SourceBank: append-only record of every user utterance (ground truth).
 * CandidateStore: LLM-maintained working hypotheses, never shown raw to the user.
 */

import { segment } from "./normalize";
import type {
  CandidateThought,
  SourceUtterance,
  UtteranceOrigin,
} from "./types";

let _nextId = 0;
let _nextTurn = 0;
export function nextId(prefix: string): string {
  return `${prefix}_${++_nextId}`;
}
/** Reset counters — call between tests to keep ids deterministic. */
export function resetIdCounter(): void {
  _nextId = 0;
  _nextTurn = 0;
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

  get(id: string): SourceUtterance | undefined {
    return this._utterances.get(id);
  }

  getAll(): SourceUtterance[] {
    return Array.from(this._utterances.values());
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

  upsert(candidate: CandidateThought): void {
    const existing = this._candidates.get(candidate.id);
    if (existing) {
      // Merge evidence and relation signals rather than replace, so no turn's
      // data is silently lost on an update.
      const mergedEvidence = Array.from(
        new Set([
          ...existing.evidenceUtteranceIds,
          ...candidate.evidenceUtteranceIds,
        ]),
      );
      this._candidates.set(candidate.id, {
        ...existing,
        ...candidate,
        evidenceUtteranceIds: mergedEvidence,
        relationSignals: [
          ...existing.relationSignals,
          ...candidate.relationSignals,
        ],
      });
    } else {
      this._candidates.set(candidate.id, candidate);
    }
  }

  delete(id: string): void {
    this._candidates.delete(id);
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
}
