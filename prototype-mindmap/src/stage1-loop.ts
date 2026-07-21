import type { MindmapConfig } from "./config";
import { containsWholePhrase } from "./normalize";
import type { LLMContext, LLMMapContext, ProposalOutcomeContext, SelectedFocusContext, UserRequestedMode } from "./llm-contract";
import { inspectAction } from "./action-gateway";
import type {
  AssistantModel,
  AssistantResponseEnvelope,
  CandidateLifecycleChange,
  ConversationState,
  DiagnosticEvent,
  StructuredRejection,
  TurnProgressEvent,
  TurnResult,
  VerifiedRecall,
} from "./assistant-response";
import { ModelResponseValidationError } from "./assistant-response";
import type { ThoughtUnitStore } from "./map-store";
import type { Proposal, ProposalAttribution } from "./proposal-store";
import type { AssistanceContract, AssistanceContractSnapshot, InfluenceTrace } from "./assistance-contract";
import { DEFAULT_ASSISTANCE_CONTRACT, snapshotContract } from "./assistance-contract";
import { CandidateStore, SourceBank } from "./store";
import { detectTurnShape } from "./turn-shape";
import type { CandidateThought, CandidateTarget, GroundedClaim, SourceUtterance } from "./types";
import { validateGroundedClaims, validateMirror } from "./validator";

export interface ProcessTurnOptions {
  mapRevision: number;
  requireConnectionLabel: boolean;
  selectedFocus?: SelectedFocusContext;
  requestedSupport?: UserRequestedMode;
  proposalOutcome?: ProposalOutcomeContext;
  store: ThoughtUnitStore;
  contract?: AssistanceContract;
  priorAssistant?: { id: number; text: string };
  /** Captured before the composer consumes canvas selection. */
  selectedCardIds?: string[];
  turnUtteranceIds?: string[];
  onProgress?: (event: TurnProgressEvent) => void;
}

export const MAX_REFLECTION_ATTEMPTS = 2;
export const MAX_MODEL_CALLS_PER_TURN = 3;

function diagnostic(stage: DiagnosticEvent["stage"], outcome: DiagnosticEvent["outcome"], code: string, detail: string): DiagnosticEvent {
  return { id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), stage, outcome, code, detail };
}

const REPAIR_FAILURE_MESSAGE = "I couldn’t complete that response reliably. You can rephrase or try again.";

function exhaustedRepair(state: ConversationState, diagnostics: DiagnosticEvent[]): TurnResult {
  state.turnsSinceLastReflection++;
  return {
    terminal: { kind: "repair_failed", message: REPAIR_FAILURE_MESSAGE },
    diagnostics,
  };
}

export function createConversationState(): ConversationState {
  return { bank: new SourceBank(), candidates: new CandidateStore(), draft: "", turnsSinceLastReflection: 0, lastAssistantText: "", currentUserTurn: 0, legacyIgnoredCandidateIds: [] };
}

export function cloneConversationState(state: ConversationState): ConversationState {
  const clone = createConversationState();
  clone.bank.replaceAll(state.bank.getAll());
  clone.candidates.replaceAll(state.candidates.getAll());
  clone.draft = state.draft;
  clone.currentDraftSnapshotId = state.currentDraftSnapshotId;
  clone.draftSnapshotText = state.draftSnapshotText;
  clone.turnsSinceLastReflection = state.turnsSinceLastReflection;
  clone.lastAssistantText = state.lastAssistantText;
  clone.currentUserTurn = state.currentUserTurn;
  clone.legacyIgnoredCandidateIds = [...state.legacyIgnoredCandidateIds];
  clone.candidates.setLegacyIgnoredIds(clone.legacyIgnoredCandidateIds);
  return clone;
}

export function mergeConversationBank(target: ConversationState, live: ConversationState): void {
  const merged = new Map(target.bank.getAll().map((utterance) => [utterance.id, utterance]));
  for (const utterance of live.bank.getAll()) {
    const current = merged.get(utterance.id);
    merged.set(utterance.id, current ? { ...current, commandOnly: Boolean(current.commandOnly || utterance.commandOnly), nonHarvestable: Boolean(current.nonHarvestable || utterance.nonHarvestable) } : utterance);
  }
  target.bank.replaceAll([...merged.values()]);
}

function phraseIsExact(phrase: string, ids: string[], bank: SourceUtterance[]): boolean {
  return ids.some((id) => containsWholePhrase(bank.find((item) => item.id === id)?.text ?? "", phrase));
}

export function deriveClaimAttribution(claim: GroundedClaim, bank: SourceUtterance[]): ProposalAttribution {
  const spansAsserted = claim.sourceSpans.length > 0 && claim.sourceSpans.every((span) => phraseIsExact(span.userPhrase, span.utteranceIds, bank));
  const relationAsserted = claim.target === "idea" || Boolean(claim.relationSpan && phraseIsExact(claim.relationSpan.text, [claim.relationSpan.utteranceId], bank));
  return spansAsserted && relationAsserted ? "asserted" : "inferred";
}

function influenceTrace(phrases: string[], priorAssistant?: { id: number; text: string }): InfluenceTrace | undefined {
  if (!priorAssistant) return undefined;
  const considered = Array.from(new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean)));
  const exactOverlapPhrases = considered.filter((phrase) => containsWholePhrase(priorAssistant.text, phrase));
  if (!exactOverlapPhrases.length) return undefined;
  const overlapRatio = considered.length ? exactOverlapPhrases.length / considered.length : 0;
  return { priorAssistantMessageId: priorAssistant.id, exactOverlapPhrases, overlapRatio };
}

function optionIsVerbatim(option: { text: string; sourceSpans: Array<{ userPhrase: string; utteranceIds: string[] }> }, bank: SourceUtterance[]): boolean {
  const utteranceIds = Array.from(new Set(option.sourceSpans.flatMap((span) => span.utteranceIds)));
  return option.sourceSpans.length > 0
    && option.sourceSpans.every((span) => phraseIsExact(span.userPhrase, span.utteranceIds, bank))
    && phraseIsExact(option.text, utteranceIds, bank);
}

function contractRejectsResponse(envelope: AssistantResponseEnvelope, contract: AssistanceContract, bank: SourceUtterance[]): StructuredRejection | undefined {
  if (!contract.allowedResponseKinds.includes(envelope.response.kind)) {
    return { code: "contract_response_kind_not_allowed", detail: `${envelope.response.kind} is not available at ${contract.label}.` };
  }
  if (envelope.response.kind === "options" && contract.optionsMustBeVerbatim && !envelope.response.options.every((option) => optionIsVerbatim(option, bank))) {
    return { code: "contract_options_not_verbatim", detail: "Every option must be grounded in exact user wording." };
  }
  if (envelope.response.kind === "grounded_recap" && envelope.advisory?.candidateUpserts?.length) {
    return { code: "grounded_recap_candidate_advisory_not_allowed", detail: "A conversational recap cannot nominate capturable structure." };
  }
  return undefined;
}

function eligibleEvidence(bank: SourceBank, ids: string[]): SourceUtterance[] {
  return Array.from(new Set(ids)).flatMap((id) => {
    const utterance = bank.get(id);
    return utterance && !utterance.commandOnly && !utterance.nonHarvestable && utterance.text.trim() ? [utterance] : [];
  });
}

function prepareAdvisory(state: ConversationState, envelope: AssistantResponseEnvelope): { store: CandidateStore; diagnostics: DiagnosticEvent[]; changes: CandidateLifecycleChange[] } {
  const store = new CandidateStore();
  store.replaceAll(state.candidates.getAll());
  store.setLegacyIgnoredIds(state.legacyIgnoredCandidateIds);
  const diagnostics: DiagnosticEvent[] = [];
  const changes: CandidateLifecycleChange[] = [];
  for (const candidate of envelope.advisory?.candidateUpserts ?? []) {
    const existing = store.get(candidate.id);
    const validEvidence = eligibleEvidence(state.bank, candidate.addEvidenceIds).map((utterance) => utterance.id);
    if (!existing && validEvidence.length === 0) {
      diagnostics.push(diagnostic("validation", "rejected", "candidate_evidence_invalid", `Candidate ${candidate.id} was not stored because it had no eligible user evidence.`));
      continue;
    }
    const next: CandidateThought = {
      id: candidate.id,
      target: candidate.target,
      gist: candidate.gist,
      evidenceUtteranceIds: validEvidence,
      status: candidate.status,
      createdTurn: existing?.createdTurn ?? state.currentUserTurn,
      lastTouchedTurn: state.currentUserTurn,
      lastRecalledTurn: existing?.lastRecalledTurn,
      ignoredAtTurn: existing?.ignoredAtTurn,
      promotedAtTurn: existing?.promotedAtTurn,
    };
    const outcome = store.upsert(next);
    if (outcome === "created" || outcome === "updated") {
      diagnostics.push(diagnostic("validation", "accepted", "candidate_memory_validated", `Candidate ${candidate.id} lifecycle bookkeeping was validated.`));
      changes.push({ candidateId: candidate.id, status: candidate.status, turn: state.currentUserTurn, source: "model" });
    } else {
      diagnostics.push(diagnostic("validation", "rejected", `candidate_${outcome}`, `Candidate ${candidate.id} lifecycle update was blocked.`));
    }
  }
  return { store, diagnostics, changes };
}

function validateRecall(envelope: AssistantResponseEnvelope, state: ConversationState): { recall?: VerifiedRecall; rejection?: StructuredRejection } {
  const response = envelope.response;
  if (response.kind !== "question" && response.kind !== "aside") return {};
  if (!response.recall) return {};
  const annotation = response.recall;
  const candidate = state.candidates.get(annotation.candidateId);
  if (!candidate) return { rejection: { code: "recall_candidate_unknown", detail: "The recalled candidate does not exist." } };
  if (candidate.status !== "active" && candidate.status !== "parked") return { rejection: { code: "recall_candidate_ineligible", detail: `A ${candidate.status} candidate cannot be recalled.` } };
  if (!candidate.evidenceUtteranceIds.includes(annotation.sourceUtteranceId)) return { rejection: { code: "recall_evidence_unlinked", detail: "The recalled evidence is not linked to that candidate." } };
  const utterance = state.bank.get(annotation.sourceUtteranceId);
  if (!utterance || utterance.commandOnly || utterance.nonHarvestable) return { rejection: { code: "recall_evidence_ineligible", detail: "The recalled evidence is not eligible user wording." } };
  if (!containsWholePhrase(utterance.text, annotation.userPhrase)) return { rejection: { code: "recall_phrase_not_verbatim", detail: "The recalled phrase is not verbatim user wording." } };
  if (!containsWholePhrase(response.text, annotation.userPhrase)) return { rejection: { code: "recall_phrase_not_visible", detail: "The recalled user phrase must appear in the visible response." } };
  return { recall: { ...annotation, ageInTurns: state.candidates.ageInTurns(candidate.id, state.currentUserTurn) ?? 0 } };
}

function targetForAction(kind: import("./action-gateway").ProposedAction["kind"]): CandidateTarget {
  if (kind === "nest_card") return "hierarchy";
  if (kind === "connect_cards") return "connection";
  return "idea";
}

function claimEvidenceIds(claim: GroundedClaim): string[] {
  return [
    ...claim.sourceSpans.flatMap((span) => span.utteranceIds),
    ...(claim.relationSpan ? [claim.relationSpan.utteranceId] : []),
  ];
}

function createProposal(envelope: AssistantResponseEnvelope, state: ConversationState, candidates: CandidateStore, options: ProcessTurnOptions, config: MindmapConfig, contract: AssistanceContractSnapshot): { proposal?: Proposal; rejection?: StructuredRejection; diagnostics: DiagnosticEvent[] } {
  const response = envelope.response;
  if (response.kind === "grounded_recap") {
    const claims = response.recap.claims;
    const evidenceIds = Array.from(new Set(claims.flatMap(claimEvidenceIds)));
    const evidence = evidenceIds.map((id) => state.bank.get(id));
    const citesDraft = evidence.some((utterance) => utterance?.origin === "draft");
    const citesEligibleChat = evidence.some((utterance) => utterance?.origin === "chat" && !utterance.commandOnly && !utterance.nonHarvestable);

    if (!evidenceIds.length || evidence.some((utterance) => !utterance || utterance.commandOnly || utterance.nonHarvestable)) {
      return { rejection: { code: "grounded_recap_evidence_ineligible", detail: "A recap may cite only existing, harvestable user wording." }, diagnostics: [diagnostic("validation", "rejected", "grounded_recap_evidence_ineligible", "A grounded recap cited missing or ineligible evidence.")] };
    }

    if (contract.level === 0 && evidenceIds.some((id) => !options.turnUtteranceIds?.includes(id))) {
      return { rejection: { code: "grounded_recap_not_current_turn", detail: "At L0, a recap may only restate the current user turn." }, diagnostics: [diagnostic("validation", "rejected", "grounded_recap_not_current_turn", "A non-directive recap cited wording outside the current user turn.")] };
    }
    if (citesDraft && contract.level < 1) {
      return { rejection: { code: "grounded_recap_cites_draft_at_l0", detail: "Draft evidence is available for recaps at L1 and L2 only." }, diagnostics: [diagnostic("validation", "rejected", "grounded_recap_cites_draft_at_l0", "A non-directive recap cited draft evidence.")] };
    }
    if (citesDraft && !citesEligibleChat) {
      return { rejection: { code: "grounded_recap_draft_without_chat_anchor", detail: "A draft-grounded recap must also cite the chat wording it brings together." }, diagnostics: [diagnostic("validation", "rejected", "grounded_recap_draft_without_chat_anchor", "A draft-grounded recap did not cite eligible chat wording.")] };
    }
    const validation = validateGroundedClaims(claims, state.bank.getAll(), config);
    if (!validation.ok || !claims.every((claim) => deriveClaimAttribution(claim, state.bank.getAll()) === "asserted")) {
      return { rejection: { code: "grounded_recap_validation_failed", detail: "The recap must use exact, source-backed user wording." }, diagnostics: [diagnostic("validation", "rejected", "grounded_recap_validation_failed", "Grounded recap evidence pointers did not validate.")] };
    }
    return { diagnostics: [diagnostic("validation", "accepted", "grounded_recap_valid", "Grounded recap evidence pointers validated; no map proposal was created.")] };
  }
  if (response.kind === "reflection") {
    const citesDraft = response.reflection.claims.some((claim) => {
      const evidenceIds = [
        ...claim.sourceSpans.flatMap((span) => span.utteranceIds),
        ...(claim.relationSpan ? [claim.relationSpan.utteranceId] : []),
      ];
      return evidenceIds.some((id) => state.bank.get(id)?.origin === "draft");
    });
    if (citesDraft && contract.level < 1) {
      return { rejection: { code: "reflection_cites_draft_at_l0", detail: "Draft evidence is available for mirrors at L1 and L2 only." }, diagnostics: [diagnostic("validation", "rejected", "reflection_cites_draft_at_l0", "A non-directive reflection cited draft evidence.")] };
    }
    if (citesDraft) {
      const citesEligibleChat = response.reflection.claims.some((claim) => {
        const evidenceIds = [
          ...claim.sourceSpans.flatMap((span) => span.utteranceIds),
          ...(claim.relationSpan ? [claim.relationSpan.utteranceId] : []),
        ];
        return evidenceIds.some((id) => {
          const utterance = state.bank.get(id);
          return utterance?.origin === "chat" && !utterance.commandOnly && !utterance.nonHarvestable;
        });
      });
      if (!citesEligibleChat) {
        return { rejection: { code: "reflection_draft_without_chat_anchor", detail: "A draft-grounded reflection must also cite the chat wording it juxtaposes." }, diagnostics: [diagnostic("validation", "rejected", "reflection_draft_without_chat_anchor", "A draft-grounded reflection did not cite eligible chat wording.")] };
      }
    }
    const validation = validateMirror(response.reflection, state.bank.getAll(), config);
    if (!validation.ok) {
      const ungroundedContentWords = Array.from(new Set(validation.claims.flatMap((claim) => claim.ungroundedContentWords)));
      const diagnosticDetail = ungroundedContentWords.length
        ? `Reflection evidence pointers did not validate. Unsupported content words: ${ungroundedContentWords.join(", ")}.`
        : "Reflection evidence pointers did not validate.";
      return {
        rejection: {
          code: "reflection_validation_failed",
          detail: validation.claims.filter((claim) => !claim.ok).map((claim) => claim.message).join(" "),
          reflectionRecovery: { stage: "informed_repair", ungroundedContentWords, rejectedReflections: [response] },
        },
        diagnostics: [diagnostic("validation", "rejected", "reflection_validation_failed", diagnosticDetail)],
      };
    }
    const attributions = response.reflection.claims.map((claim) => deriveClaimAttribution(claim, state.bank.getAll()));
    if (!attributions.every((value) => value === "asserted")) return { rejection: { code: "reflection_not_user_asserted", detail: "Reflections must remain grounded in user assertions; use a suggestion for new material." }, diagnostics: [diagnostic("validation", "rejected", "reflection_not_user_asserted", "Reflection was not fully asserted.")] };
    const invalidCandidate = response.reflection.claims.find((claim) => {
      const candidate = candidates.get(claim.candidateId);
      return !candidate || (candidate.status !== "active" && candidate.status !== "parked") || candidate.target !== claim.target;
    });
    if (invalidCandidate) return { rejection: { code: "reflection_candidate_invalid", detail: `Reflection claim ${invalidCandidate.id} does not reference an eligible matching candidate.` }, diagnostics: [diagnostic("validation", "rejected", "reflection_candidate_invalid", "Reflection candidate linkage did not validate.")] };
    const trace = influenceTrace(response.reflection.claims.flatMap((claim) => [...claim.sourceSpans.map((span) => span.userPhrase), claim.relationSpan?.text ?? ""]), options.priorAssistant);
    const proposal: Proposal = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      mapRevision: options.mapRevision,
      referencedCardIds: [],
      origin: citesDraft ? "ai_connected" : "user_asserted",
      influenceTrace: trace,
      contract,
      state: "shown",
      detail: { kind: "reflection", reflection: response.reflection, claims: validation.claims, decisions: Object.fromEntries(response.reflection.claims.map((claim) => [claim.id, "pending"])), editedTexts: Object.fromEntries(response.reflection.claims.map((claim) => [claim.id, claim.text])) },
    };
    return { proposal, diagnostics: [diagnostic("validation", "accepted", "reflection_valid", "Reflection evidence pointers validated."), diagnostic("proposal", "accepted", "proposal_shown", "Reflection is awaiting an explicit user decision.")] };
  }
  if (response.kind === "map_proposal") {
    if (response.candidateId) {
      const candidate = candidates.get(response.candidateId);
      if (!candidate || (candidate.status !== "active" && candidate.status !== "parked") || candidate.target !== targetForAction(response.action.kind)) {
        return { rejection: { code: "map_candidate_invalid", detail: "The linked candidate is missing, promoted, or does not match the proposed action." }, diagnostics: [diagnostic("validation", "rejected", "map_candidate_invalid", "Map proposal candidate linkage did not validate.")] };
      }
    }
    const checked = inspectAction(response.action, { actor: "ai_proposal", store: options.store, bank: state.bank, requireConnectionLabel: options.requireConnectionLabel, allowAiSuggestedStructure: contract.allowsAiSuggestedStructure, allowGroundedOptions: contract.allowedResponseKinds.includes("options"), turnUtteranceIds: options.turnUtteranceIds, selectedCardIds: options.selectedCardIds });
    if (checked.status === "rejected") return { rejection: { code: checked.reason, detail: checked.detail }, diagnostics: [diagnostic("gateway", "rejected", checked.reason, checked.detail)] };
    const proposal: Proposal = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      mapRevision: options.mapRevision,
      referencedCardIds: checked.status === "ready" || checked.status === "needs_relationship_label" ? checked.referencedCardIds : [],
      // A missing label or ambiguous reference says nothing about authorship.
      // It remains unresolved until the user completes it inline, rather than
      // being mis-recorded as an AI inference.
      origin: checked.status === "ready" ? (checked.origin ?? "user_asserted") : checked.status === "needs_relationship_label" ? checked.pairingOrigin : "unresolved",
      influenceTrace: influenceTrace([
        ...(response.action.kind === "create_card" || response.action.kind === "edit_card" ? [response.action.text] : []),
        ...(response.action.kind === "connect_cards" ? [response.action.labelText ?? "", response.action.relationEvidence?.text ?? ""] : []),
        ...(response.action.kind === "nest_card" ? [response.action.relationEvidence?.text ?? ""] : []),
      ], options.priorAssistant),
      contract,
      state: "shown",
      detail: {
        kind: "map_action", action: response.action, candidateId: response.candidateId,
        executable: checked.status === "ready" ? checked.action : undefined,
        pairingProof: checked.status === "ready" ? checked.pairingProof : checked.status === "needs_relationship_label" ? checked.pairingProof : undefined,
        completion: checked.status === "needs_relationship_label"
          ? { kind: "relationship_label", pairingProof: checked.pairingProof, pairingOrigin: checked.pairingOrigin, options: checked.options }
          : checked.status === "needs_reference_choice"
            ? { kind: "reference_choice", slot: checked.slot, candidates: checked.candidates }
            : checked.status === "needs_input" ? { kind: "generic", fields: checked.fields } : undefined,
      },
    };
    return { proposal, diagnostics: [diagnostic("gateway", checked.status === "ready" ? "accepted" : "needs_input", checked.status === "ready" ? "action_ready" : "inline_completion_required", checked.status === "ready" ? "Map action passed deterministic checks." : checked.detail), diagnostic("proposal", "accepted", "proposal_shown", "Map action is awaiting an explicit user decision.")] };
  }
  return { diagnostics: [] };
}

/**
 * A reflection historically carried two independently model-authored prose
 * surfaces: `response.text` in chat and the pointer-validated claim text in the
 * review card. Only the claims cross the grounding validator. Derive the chat
 * text from those accepted claims so an unvalidated wrapper can never become a
 * second visible reflection. The provider field remains parse-compatible.
 */
function acceptedVisibleResponse(response: AssistantResponseEnvelope["response"]): AssistantResponseEnvelope["response"] {
  if (response.kind === "grounded_recap") {
    return { ...response, text: response.recap.claims.map((claim) => claim.text).join("\n") };
  }
  if (response.kind !== "reflection") return response;
  return {
    ...response,
    text: response.reflection.claims.map((claim) => claim.text).join("\n"),
  };
}

function prepareEnvelope(envelope: AssistantResponseEnvelope, state: ConversationState, options: ProcessTurnOptions, config: MindmapConfig, activeContract: AssistanceContract, contractSnapshot: AssistanceContractSnapshot): { proposal?: Proposal; recall?: VerifiedRecall; candidates: CandidateStore; lifecycleChanges: CandidateLifecycleChange[]; rejection?: StructuredRejection; diagnostics: DiagnosticEvent[] } {
  const contractRejection = contractRejectsResponse(envelope, activeContract, state.bank.getAll());
  const advisory = prepareAdvisory(state, envelope);
  if (contractRejection) return { candidates: advisory.store, lifecycleChanges: advisory.changes, rejection: contractRejection, diagnostics: [diagnostic("validation", "rejected", contractRejection.code, contractRejection.detail), ...advisory.diagnostics] };
  const anchor = envelope.response.kind === "question" ? envelope.response.anchor : undefined;
  if (anchor && !state.draft.includes(anchor)) {
    const rejection = { code: "draft_anchor_not_exact", detail: "The question anchor must be an exact substring of the current draft." };
    return { candidates: advisory.store, lifecycleChanges: advisory.changes, rejection, diagnostics: [diagnostic("validation", "rejected", rejection.code, rejection.detail), ...advisory.diagnostics] };
  }
  const recalled = validateRecall(envelope, state);
  if (recalled.rejection) return { candidates: advisory.store, lifecycleChanges: advisory.changes, rejection: recalled.rejection, diagnostics: [diagnostic("validation", "rejected", recalled.rejection.code, recalled.rejection.detail), ...advisory.diagnostics] };
  const proposal = createProposal(envelope, state, advisory.store, options, config, contractSnapshot);
  return { ...proposal, recall: recalled.recall, candidates: advisory.store, lifecycleChanges: advisory.changes, diagnostics: [...advisory.diagnostics, ...proposal.diagnostics] };
}

export function buildContext(state: ConversationState, userText: string, added: SourceUtterance[], map: LLMMapContext, config: MindmapConfig, selectedFocus?: SelectedFocusContext, requestedSupport?: UserRequestedMode, contract?: AssistanceContract, proposalOutcome?: ProposalOutcomeContext): LLMContext {
  const shape = detectTurnShape(userText, added);
  const cardCount = map.thoughtUnits.filter((unit) => unit.role !== "connection_label").length;
  return {
    bank: state.bank.getAll().filter((utterance) => !utterance.nonHarvestable && (utterance.origin !== "draft" || utterance.draftSnapshotId === state.currentDraftSnapshotId)),
    candidates: state.candidates.getAll().map((candidate) => ({
      id: candidate.id,
      target: candidate.target,
      status: candidate.status,
      gist: candidate.gist,
      ageInTurns: Math.max(0, state.currentUserTurn - candidate.lastTouchedTurn),
      evidence: eligibleEvidence(state.bank, candidate.evidenceUtteranceIds).map((utterance) => ({ utteranceId: utterance.id, text: utterance.text })),
      ...(candidate.lastRecalledTurn === undefined ? {} : { lastRecalledAgeInTurns: Math.max(0, state.currentUserTurn - candidate.lastRecalledTurn) }),
    })),
    turnShape: shape,
    capabilities: config.capabilities,
    mapPacing: { cardCount, connectionCount: map.connections.length, isSparse: cardCount < 2 },
    reflectionRhythm: { turnsSinceLastReflection: state.turnsSinceLastReflection, sourceUtteranceCount: state.bank.getAll().filter((utterance) => !utterance.nonHarvestable && !utterance.commandOnly).length },
    thinkMapBias: config.pacing.thinkMapBias,
    map,
    draft: state.draft,
    selectedFocus,
    requestedSupport,
    proposalOutcome,
    assistanceContract: contract ? snapshotContract(contract) : undefined,
  };
}

export async function processTurn(state: ConversationState, userText: string, model: AssistantModel, config: MindmapConfig, map: LLMMapContext, options: ProcessTurnOptions): Promise<TurnResult> {
  if (state.draft.trim() && state.draft !== state.draftSnapshotText) {
    state.currentDraftSnapshotId = state.bank.addDraftSnapshot(state.draft).snapshotId;
    state.draftSnapshotText = state.draft;
  }
  if (userText.trim()) state.currentUserTurn++;
  const added = userText.trim() ? state.bank.addSegmented(userText, "chat") : [];
  const turnOptions: ProcessTurnOptions = { ...options, turnUtteranceIds: added.map((utterance) => utterance.id) };
  const activeContract = options.contract ?? DEFAULT_ASSISTANCE_CONTRACT;
  const contractSnapshot = snapshotContract(activeContract);
  const context = buildContext(state, userText, added, map, config, options.selectedFocus, options.requestedSupport, activeContract, options.proposalOutcome);
  const diagnostics: DiagnosticEvent[] = [];
  let envelope: AssistantResponseEnvelope;
  let prepared: ReturnType<typeof prepareEnvelope> | undefined;
  let modelCall: 1 | 2 | 3 = 1;
  let recoveryUsed = false;

  const callModel = async (call: 1 | 2 | 3, rejection?: StructuredRejection, progressStage?: TurnProgressEvent["stage"]): Promise<AssistantResponseEnvelope> => {
    modelCall = call;
    if (progressStage) options.onProgress?.({ modelCall: call, stage: progressStage });
    return model(context, rejection);
  };

  const recordResponse = (responseEnvelope: AssistantResponseEnvelope): void => {
    diagnostics.push(diagnostic("response", "accepted", responseEnvelope.response.kind, `Model call ${modelCall} returned ${responseEnvelope.response.kind}.`));
  };

  try {
    envelope = await callModel(1, undefined, "initial_attempt");
  } catch (error) {
    if (!(error instanceof ModelResponseValidationError)) throw error;
    const detail = error instanceof Error ? error.message : "The provider response could not be parsed.";
    const rejection: StructuredRejection = { code: "provider_response_invalid", detail };
    diagnostics.push(diagnostic("response", "rejected", rejection.code, rejection.detail));
    diagnostics.push(diagnostic("repair", "needs_input", "repair_requested", "One structured repair call was requested."));
    recoveryUsed = true;
    try {
      envelope = await callModel(2, rejection);
    } catch (repairError) {
      if (!(repairError instanceof ModelResponseValidationError)) throw repairError;
      diagnostics.push(diagnostic("repair", "rejected", "repair_failed", repairError.message));
      return exhaustedRepair(state, diagnostics);
    }
    recordResponse(envelope);
    prepared = prepareEnvelope(envelope, state, turnOptions, config, activeContract, contractSnapshot);
    diagnostics.push(...prepared.diagnostics);
    if (prepared.rejection) {
      diagnostics.push(diagnostic("repair", "rejected", "repair_failed", prepared.rejection.detail));
      return exhaustedRepair(state, diagnostics);
    }
  }

  if (!recoveryUsed) {
    recordResponse(envelope);
    prepared = prepareEnvelope(envelope, state, turnOptions, config, activeContract, contractSnapshot);
    diagnostics.push(...prepared.diagnostics);

    if (prepared.rejection?.code === "reflection_validation_failed") {
      const firstReflectionRejection = prepared.rejection;
      diagnostics.push(diagnostic("repair", "needs_input", "repair_requested", "An informed reflection repair was requested."));
      diagnostics.push(diagnostic("repair", "needs_input", "grounding_repair_requested", "The model received the rejected reflection and its ungrounded content words."));
      recoveryUsed = true;
      try {
        envelope = await callModel(2, firstReflectionRejection, "grounding_repair");
      } catch (repairError) {
        if (!(repairError instanceof ModelResponseValidationError)) throw repairError;
        diagnostics.push(diagnostic("repair", "rejected", "repair_failed", repairError.message));
        return exhaustedRepair(state, diagnostics);
      }
      recordResponse(envelope);
      prepared = prepareEnvelope(envelope, state, turnOptions, config, activeContract, contractSnapshot);
      diagnostics.push(...prepared.diagnostics);

      if (prepared.rejection?.code === "reflection_validation_failed" && envelope.response.kind === "reflection") {
        const secondRecovery = prepared.rejection.reflectionRecovery;
        const firstRecovery = firstReflectionRejection.reflectionRecovery;
        const forcedQuestionRejection: StructuredRejection = {
          code: "reflection_forced_question",
          detail: "Two reflection attempts could not be grounded. Return one targeted question instead.",
          reflectionRecovery: {
            stage: "forced_question",
            ungroundedContentWords: Array.from(new Set([
              ...(firstRecovery?.ungroundedContentWords ?? []),
              ...(secondRecovery?.ungroundedContentWords ?? []),
            ])),
            rejectedReflections: [
              ...(firstRecovery?.rejectedReflections ?? []),
              ...(secondRecovery?.rejectedReflections ?? []),
            ].slice(0, MAX_REFLECTION_ATTEMPTS),
          },
        };
        diagnostics.push(diagnostic("repair", "needs_input", "forced_question_requested", "The capped recovery ladder requested one targeted question."));
        try {
          envelope = await callModel(3, forcedQuestionRejection, "forced_question");
        } catch (forcedError) {
          if (!(forcedError instanceof ModelResponseValidationError)) throw forcedError;
          diagnostics.push(diagnostic("repair", "rejected", "repair_failed", forcedError.message));
          return exhaustedRepair(state, diagnostics);
        }
        recordResponse(envelope);
        if (envelope.response.kind !== "question") {
          diagnostics.push(diagnostic("repair", "rejected", "forced_question_kind_invalid", `The final recovery call returned ${envelope.response.kind}, not a question.`));
          diagnostics.push(diagnostic("repair", "rejected", "repair_failed", "The final recovery response was not a question."));
          return exhaustedRepair(state, diagnostics);
        }
        prepared = prepareEnvelope(envelope, state, turnOptions, config, activeContract, contractSnapshot);
        diagnostics.push(...prepared.diagnostics);
      }

      if (prepared.rejection) {
        diagnostics.push(diagnostic("repair", "rejected", "repair_failed", prepared.rejection.detail));
        return exhaustedRepair(state, diagnostics);
      }
    } else if (prepared.rejection) {
      diagnostics.push(diagnostic("repair", "needs_input", "repair_requested", "One structured repair call was requested."));
      recoveryUsed = true;
      try {
        envelope = await callModel(2, prepared.rejection);
      } catch (repairError) {
        if (!(repairError instanceof ModelResponseValidationError)) throw repairError;
        diagnostics.push(diagnostic("repair", "rejected", "repair_failed", repairError.message));
        return exhaustedRepair(state, diagnostics);
      }
      recordResponse(envelope);
      prepared = prepareEnvelope(envelope, state, turnOptions, config, activeContract, contractSnapshot);
      diagnostics.push(...prepared.diagnostics);
      if (prepared.rejection) {
        diagnostics.push(diagnostic("repair", "rejected", "repair_failed", prepared.rejection.detail));
        return exhaustedRepair(state, diagnostics);
      }
    }
  }

  if (!prepared) throw new Error("Turn completed without a prepared response.");
  if (recoveryUsed) diagnostics.push(diagnostic("repair", "repaired", "repair_succeeded", `The typed response passed after ${modelCall} model calls.`));
  state.candidates = prepared.candidates;
  if (prepared.recall) {
    state.candidates.markRecalled(prepared.recall.candidateId, state.currentUserTurn);
    diagnostics.push(diagnostic("application", "accepted", "candidate_recalled", `Candidate ${prepared.recall.candidateId} was recalled from user wording.`));
  }
  const acceptedResponse = acceptedVisibleResponse(envelope.response);
  state.lastAssistantText = acceptedResponse.text;
  if (acceptedResponse.kind === "reflection" || acceptedResponse.kind === "grounded_recap") state.turnsSinceLastReflection = 0;
  else state.turnsSinceLastReflection++;
  return { response: acceptedResponse, proposal: prepared.proposal, recall: prepared.recall, lifecycleChanges: prepared.lifecycleChanges, diagnostics };
}
