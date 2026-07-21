import type { AssistanceContractSnapshot, ContributionOrigin, InfluenceTrace } from "./assistance-contract";

export type LedgerEventKind =
  | "contract_initialized" | "contract_selected" | "contract_changed"
  | "user_message" | "model_request" | "assistant_response"
  | "provider_tool_requested" | "provider_tool_result"
  | "pointer_validation" | "contract_decision" | "assistant_echo_overlap"
  | "proposal_created" | "proposal_edited" | "proposal_resolved" | "proposal_invalidated" | "map_mutated"
  | "application_recovery" | "candidate_lifecycle_changed" | "candidate_recalled" | "suggestion_adoption_changed";

export interface LocalLedgerEvent {
  sessionId: string;
  sequence: number;
  at: number;
  kind: LedgerEventKind;
  contract?: AssistanceContractSnapshot;
  origin?: ContributionOrigin;
  influenceTrace?: InfluenceTrace;
  /** Full local-only payload: may contain user and provider content. */
  detail?: unknown;
}

export interface SanitizedMindmapEvent {
  sessionId: string;
  sequence: number;
  at: number;
  kind: LedgerEventKind;
  contractId?: string;
  contractLevel?: number;
  responseKind?: string;
  origin?: ContributionOrigin;
  outcome?: string;
  code?: string;
  durationMs?: number;
  providerTransport?: "chat_json" | "responses_tools";
  toolName?: "propose_reflection_v1" | "propose_map_action_v1";
  repairCount?: number;
  candidateStatus?: "active" | "parked" | "ignored" | "promoted";
  ageInTurns?: number;
  currentPercentage?: number;
  peakPercentage?: number;
}

const DB = "mindmap-assistance-ledger";
const STORE = "events";

export class EventLedger {
  private sequence = 0;
  private unavailable = false;
  private loadedExistingSequence = false;
  private tail: Promise<void> = Promise.resolve();
  constructor(readonly sessionId: string) {}
  get isAvailable(): boolean { return !this.unavailable; }

  record(kind: LedgerEventKind, detail?: unknown, meta?: Pick<LocalLedgerEvent, "contract" | "origin" | "influenceTrace">): Promise<LocalLedgerEvent> {
    const operation = this.tail.then(() => this.writeRecord(kind, detail, meta));
    this.tail = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async writeRecord(kind: LedgerEventKind, detail?: unknown, meta?: Pick<LocalLedgerEvent, "contract" | "origin" | "influenceTrace">): Promise<LocalLedgerEvent> {
    if (typeof indexedDB === "undefined") {
      this.unavailable = true;
      return { sessionId: this.sessionId, sequence: ++this.sequence, at: Date.now(), kind, detail, ...meta };
    }
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ["sessionId", "sequence"] });
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (!this.loadedExistingSequence) {
        const existing = await new Promise<LocalLedgerEvent[]>((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const request = tx.objectStore(STORE).getAll();
          request.onsuccess = () => resolve(request.result as LocalLedgerEvent[]);
          request.onerror = () => reject(request.error);
        });
        this.sequence = Math.max(this.sequence, ...existing.filter((item) => item.sessionId === this.sessionId).map((item) => item.sequence), 0);
        this.loadedExistingSequence = true;
      }
      const event: LocalLedgerEvent = { sessionId: this.sessionId, sequence: ++this.sequence, at: Date.now(), kind, detail, ...meta };
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(event);
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
      });
      db.close();
      return event;
    } catch {
      this.unavailable = true;
      return { sessionId: this.sessionId, sequence: ++this.sequence, at: Date.now(), kind, detail, ...meta };
    }
  }
}

export function sanitizedEvent(event: LocalLedgerEvent, extra: Omit<SanitizedMindmapEvent, "sessionId" | "sequence" | "at" | "kind" | "contractId" | "contractLevel" | "origin"> = {}): SanitizedMindmapEvent {
  return { sessionId: event.sessionId, sequence: event.sequence, at: event.at, kind: event.kind, contractId: event.contract?.id, contractLevel: event.contract?.level, origin: event.origin, ...extra };
}

export async function mirrorSanitizedEvent(event: LocalLedgerEvent, extra?: Parameters<typeof sanitizedEvent>[1]): Promise<void> {
  try {
    const base = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:8000/api";
    await fetch(`${base}/mindmap/events`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sanitizedEvent(event, extra)) });
  } catch { /* local audit is authoritative; network telemetry is best effort */ }
}
