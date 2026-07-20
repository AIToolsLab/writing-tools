import type { DiagnosticEvent } from "./assistant-response";
import type { CandidateStatus, CandidateTarget, CandidateThought, SourceUtterance } from "./types";
import { diagnosticTrace, type TraceEvent } from "./trace";

export const THESIS_BANNER = "Nothing here changes your map. Typed responses, proposals, validation, and applied actions are logged separately.";
export interface TrackedIdea { id: string; label: string; target: CandidateTarget; status: Extract<CandidateStatus, "active" | "parked" | "ignored">; evidenceCount: number; ageInTurns: number }
export type SafetyCheckState = "ok" | "info" | "held";
export interface SafetyCheck { id: string; label: string; state: SafetyCheckState }
export interface DraftAnchor { label: string; anchor: string; kind: "main_idea" | "argument" | "evidence" | "relationship" | "transition" | "definition" }
export type UnderhoodEventKind = "typed_response" | "pointer_validation" | "repair" | "gateway" | "proposal" | "application" | "question_chosen" | "readiness_changed" | "idea_tracked";
export type UnderhoodEventState = "passed" | "held" | "watching" | "chosen";
export type UnderhoodEventStage = "noticed" | "tracked" | "checked" | "held" | "chosen";
export interface UnderhoodEvent {
  id: string;
  kind: UnderhoodEventKind;
  stage?: UnderhoodEventStage;
  title: string;
  detail: string;
  evidence?: string;
  state: UnderhoodEventState;
  stateLabel: string;
  technicalDetail?: string[];
}
export interface UnderstandingSnapshot {
  latest: TraceEvent;
  activeEvents: UnderhoodEvent[];
  trackedIdeas: TrackedIdea[];
  ignoredIdeas: TrackedIdea[];
  waitingFor?: string;
  safetyChecks: SafetyCheck[];
  draftAnchors: DraftAnchor[];
  banner: string;
}

function kindFor(event: DiagnosticEvent): UnderhoodEventKind {
  if (event.stage === "response") return "typed_response";
  if (event.stage === "validation") return "pointer_validation";
  return event.stage;
}

function stateFor(event: DiagnosticEvent): UnderhoodEventState {
  if (event.outcome === "rejected") return "held";
  if (event.outcome === "needs_input") return "watching";
  if (event.outcome === "applied") return "chosen";
  return "passed";
}

function trackedIdeas(candidates: CandidateThought[], bank: SourceUtterance[], currentUserTurn: number, statuses: CandidateStatus[]): TrackedIdea[] {
  const byId = new Map(bank.map((utterance) => [utterance.id, utterance]));
  return candidates.filter((candidate) => statuses.includes(candidate.status)).flatMap((candidate) => {
    const evidence = candidate.evidenceUtteranceIds
      .map((id) => byId.get(id))
      .filter((utterance): utterance is SourceUtterance => Boolean(utterance && !utterance.commandOnly && !utterance.nonHarvestable && utterance.text.trim()));
    const latest = evidence[evidence.length - 1];
    return latest ? [{ id: candidate.id, label: latest.text, target: candidate.target, status: candidate.status as TrackedIdea["status"], evidenceCount: evidence.length, ageInTurns: Math.max(0, currentUserTurn - candidate.lastTouchedTurn) }] : [];
  });
}

export function buildDiagnosticSnapshot(events: DiagnosticEvent[], candidates: CandidateThought[] = [], bank: SourceUtterance[] = [], currentUserTurn = 0): UnderstandingSnapshot {
  return {
    latest: diagnosticTrace(events),
    activeEvents: events.map((event) => ({
      id: event.id,
      kind: kindFor(event),
      stage: event.outcome === "rejected" ? "held" : event.outcome === "applied" ? "chosen" : event.stage === "response" ? "noticed" : "checked",
      title: event.code.replace(/_/g, " "),
      detail: event.detail,
      state: stateFor(event),
      stateLabel: event.outcome.replace(/_/g, " "),
      technicalDetail: [`stage=${event.stage}`, `outcome=${event.outcome}`],
    })),
    trackedIdeas: trackedIdeas(candidates, bank, currentUserTurn, ["active", "parked"]),
    ignoredIdeas: trackedIdeas(candidates, bank, currentUserTurn, ["ignored"]),
    waitingFor: events.some((event) => event.outcome === "needs_input") ? "Inline proposal information or an explicit proposal decision." : undefined,
    safetyChecks: [{ id: "gateway", label: "All structural changes cross the deterministic action gateway.", state: events.some((event) => event.outcome === "rejected") ? "held" : "ok" }],
    draftAnchors: [],
    banner: THESIS_BANNER,
  };
}
