/// <reference types="vite/client" />

/**
 * Event ledger (Stage 2, Phase 4).
 *
 * Two sinks, one call:
 *   1. A LOCAL, full-fidelity append-only ledger in localStorage — the complete
 *      record (including verbatim text) for offline analysis on the study machine.
 *   2. A SANITIZED mirror POSTed to the backend study-log endpoint (`/api/log`) —
 *      metadata only (contract level, kind, attribution, gate-rejection reasons,
 *      counts, timings). No verbatim user/draft/card text ever leaves the client.
 *
 * The caller supplies BOTH payloads explicitly, so what is sent remote is a
 * deliberate allowlist, never an accidental leak of the full detail.
 */

const LEDGER_KEY = "mindmap.ledger.v1";

const BACKEND_URL =
  (import.meta.env.VITE_BACKEND_URL as string | undefined) ??
  "http://localhost:8000/api";

// Dev-only study identity for the sanitized log; not user-facing.
const STUDY_USERNAME =
  (import.meta.env.VITE_STUDY_USERNAME as string | undefined) ?? "prototype";

export interface LedgerEvent {
  ts: number;
  event: string;
  /** Full-fidelity detail — local only, may contain verbatim text. */
  detail: Record<string, unknown>;
}

function readAll(): LedgerEvent[] {
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LedgerEvent[]) : [];
  } catch {
    return [];
  }
}

function persist(events: LedgerEvent[]): void {
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(events));
  } catch {
    // A full/blocked localStorage must never break the session.
  }
}

/**
 * Record an event. `full` goes to the local ledger; `sanitized` (when provided)
 * is mirrored to the study-log endpoint. Pass `sanitized: null` to keep an event
 * purely local. Remote delivery is fire-and-forget — logging never blocks a turn.
 */
export function logLedgerEvent(
  event: string,
  full: Record<string, unknown> = {},
  sanitized: Record<string, unknown> | null = {},
): LedgerEvent {
  const entry: LedgerEvent = { ts: Date.now(), event, detail: full };

  const events = readAll();
  events.push(entry);
  persist(events);

  if (sanitized !== null) {
    void fetch(`${BACKEND_URL}/log`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: STUDY_USERNAME,
        event,
        timestamp: entry.ts,
        ...sanitized,
      }),
    }).catch(() => {
      // Offline / backend down is fine — the local ledger is the source of truth.
    });
  }

  return entry;
}

export function readLedger(): LedgerEvent[] {
  return readAll();
}

export function clearLedger(): void {
  persist([]);
}
