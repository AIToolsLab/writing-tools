import type { DiagnosticEvent } from "./assistant-response";

export type TraceLevel = "quiet" | "notice" | "held";
export interface TraceEvent {
  id: string;
  turnId?: string;
  reason?: string;
  icon?: string;
  level: TraceLevel;
  title: string;
  explanation: string;
}

export function diagnosticTrace(events: DiagnosticEvent[]): TraceEvent {
  const latest = events[events.length - 1];
  if (!latest) return { id: "idle", level: "quiet", title: "Idle", explanation: "No typed response has been processed yet." };
  const level: TraceLevel = latest.outcome === "rejected" ? "held" : latest.outcome === "needs_input" ? "notice" : "quiet";
  return { id: latest.id, level, title: latest.code.replace(/_/g, " "), explanation: latest.detail };
}
