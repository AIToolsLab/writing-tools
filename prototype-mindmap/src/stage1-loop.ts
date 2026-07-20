import type { MindmapConfig } from "./config";
import { containsWholePhrase } from "./normalize";
import type { LLMContext, LLMMapContext, ProposalOutcomeContext, SelectedFocusContext, UserRequestedMode } from "./llm-contract";
import { inspectAction } from "./action-gateway";
import type {
  AssistantModel,
  AssistantResponseEnvelope,
  ConversationState,
  DiagnosticEvent,
  StructuredRejection,
  TurnResult,
} from "./assistant-response";
import { ModelResponseValidationError } from "./assistant-response";
import type { ThoughtUnitStore } from "./map-store";
import type { Proposal, ProposalAttribution } from "./proposal-store";
import type { AssistanceContract, AssistanceContractSnapshot, InfluenceTrace } from "./assistance-contract";
import { DEFAULT_ASSISTANCE_CONTRACT, snapshotContract } from "./assistance-contract";
import { CandidateStore, SourceBank } from "./store";
import { detectTurnShape } from "./turn-shape";
import type { MirrorClaim, SourceUtterance } from "./types";
import { validateMirror } from "./validator";

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
}

function diagnostic(stage: DiagnosticEvent["stage"], outcome: DiagnosticEvent["outcome"], code: string, detail: string): DiagnosticEvent {
  return { id: `d_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), stage, outcome, code, detail };
}

export function createConversationState(): ConversationState {
  return { bank: new SourceBank(), candidates: new CandidateStore(), draft: "", turnsSinceLastReflection: 0, lastAssistantText: "", dismissedCandidateIds: [] };
}

export function cloneConversationState(state: ConversationState): ConversationState {
  const clone = createConversationState();
  clone.bank.replaceAll(state.bank.getAll());
  clone.candidates.replaceAll(state.candidates.getAll());
  clone.draft = state.draft;
  clone.turnsSinceLastReflection = state.turnsSinceLastReflection;
  clone.lastAssistantText = state.lastAssistantText;
  clone.dismissedCandidateIds = [...state.dismissedCandidateIds];
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

export function deriveClaimAttribution(claim: MirrorClaim, bank: SourceUtterance[]): ProposalAttribution {
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
  return undefined;
}

function applyAdvisory(state: ConversationState, envelope: AssistantResponseEnvelope): void {
  for (const candidate of envelope.advisory?.candidateUpserts ?? []) {
    state.candidates.upsert({ id: candidate.id, target: candidate.target, gist: candidate.gist, evidenceUtteranceIds: candidate.addEvidenceIds });
  }
  for (const id of envelope.advisory?.candidateDeletes ?? []) state.candidates.delete(id);
}

function createProposal(envelope: AssistantResponseEnvelope, state: ConversationState, options: ProcessTurnOptions, config: MindmapConfig, contract: AssistanceContractSnapshot): { proposal?: Proposal; rejection?: StructuredRejection; diagnostics: DiagnosticEvent[] } {
  const response = envelope.response;
  if (response.kind === "reflection") {
    const validation = validateMirror(response.reflection, state.bank.getAll(), config);
    if (!validation.ok) return { rejection: { code: "reflection_validation_failed", detail: validation.claims.filter((claim) => !claim.ok).map((claim) => claim.message).join(" ") }, diagnostics: [diagnostic("validation", "rejected", "reflection_validation_failed", "Reflection evidence pointers did not validate.")] };
    const attributions = response.reflection.claims.map((claim) => deriveClaimAttribution(claim, state.bank.getAll()));
    if (!attributions.every((value) => value === "asserted")) return { rejection: { code: "reflection_not_user_asserted", detail: "Reflections must remain grounded in user assertions; use a suggestion for new material." }, diagnostics: [diagnostic("validation", "rejected", "reflection_not_user_asserted", "Reflection was not fully asserted.")] };
    const trace = influenceTrace(response.reflection.claims.flatMap((claim) => [...claim.sourceSpans.map((span) => span.userPhrase), claim.relationSpan?.text ?? ""]), options.priorAssistant);
    const proposal: Proposal = {
      id: `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      mapRevision: options.mapRevision,
      referencedCardIds: [],
      origin: "user_asserted",
      influenceTrace: trace,
      contract,
      state: "shown",
      detail: { kind: "reflection", reflection: response.reflection, claims: validation.claims, decisions: Object.fromEntries(response.reflection.claims.map((claim) => [claim.id, "pending"])), editedTexts: Object.fromEntries(response.reflection.claims.map((claim) => [claim.id, claim.text])) },
    };
    return { proposal, diagnostics: [diagnostic("validation", "accepted", "reflection_valid", "Reflection evidence pointers validated."), diagnostic("proposal", "accepted", "proposal_shown", "Reflection is awaiting an explicit user decision.")] };
  }
  if (response.kind === "map_proposal") {
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
        kind: "map_action", action: response.action,
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

export function buildContext(state: ConversationState, userText: string, added: SourceUtterance[], map: LLMMapContext, config: MindmapConfig, selectedFocus?: SelectedFocusContext, requestedSupport?: UserRequestedMode, contract?: AssistanceContract, proposalOutcome?: ProposalOutcomeContext): LLMContext {
  const shape = detectTurnShape(userText, added);
  const cardCount = map.thoughtUnits.filter((unit) => unit.role !== "connection_label").length;
  return {
    bank: state.bank.getAll().filter((utterance) => !utterance.nonHarvestable),
    candidates: state.candidates.getAll(),
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
  const added = userText.trim() ? state.bank.addSegmented(userText, "chat") : [];
  const turnOptions: ProcessTurnOptions = { ...options, turnUtteranceIds: added.map((utterance) => utterance.id) };
  const activeContract = options.contract ?? DEFAULT_ASSISTANCE_CONTRACT;
  const contractSnapshot = snapshotContract(activeContract);
  const context = buildContext(state, userText, added, map, config, options.selectedFocus, options.requestedSupport, activeContract, options.proposalOutcome);
  const diagnostics: DiagnosticEvent[] = [];
  let repairUsed = false;
  let envelope: AssistantResponseEnvelope;
  try {
    envelope = await model(context);
  } catch (error) {
    if (!(error instanceof ModelResponseValidationError)) throw error;
    const detail = error instanceof Error ? error.message : "The provider response could not be parsed.";
    const rejection: StructuredRejection = { code: "provider_response_invalid", detail };
    diagnostics.push(diagnostic("response", "rejected", rejection.code, rejection.detail));
    diagnostics.push(diagnostic("repair", "needs_input", "repair_requested", "One structured repair call was requested."));
    repairUsed = true;
    try {
      envelope = await model(context, rejection);
    } catch (repairError) {
      if (!(repairError instanceof ModelResponseValidationError)) throw repairError;
      const repairDetail = repairError instanceof Error ? repairError.message : "The repaired provider response could not be parsed.";
      diagnostics.push(diagnostic("repair", "rejected", "repair_failed", repairDetail));
      state.turnsSinceLastReflection++;
      return { diagnostics };
    }
  }
  diagnostics.push(diagnostic("response", "accepted", envelope.response.kind, `Model returned ${envelope.response.kind}.`));
  let rejection = contractRejectsResponse(envelope, activeContract, state.bank.getAll());
  let prepared = rejection ? { rejection, diagnostics: [diagnostic("validation", "rejected", rejection.code, rejection.detail)] } : createProposal(envelope, state, turnOptions, config, contractSnapshot);
  diagnostics.push(...prepared.diagnostics);
  if (prepared.rejection) {
    if (repairUsed) {
      diagnostics.push(diagnostic("repair", "rejected", "repair_failed", prepared.rejection.detail));
      state.turnsSinceLastReflection++;
      return { diagnostics };
    }
    diagnostics.push(diagnostic("repair", "needs_input", "repair_requested", "One structured repair call was requested."));
    try {
      envelope = await model(context, prepared.rejection);
    } catch (repairError) {
      if (!(repairError instanceof ModelResponseValidationError)) throw repairError;
      diagnostics.push(diagnostic("repair", "rejected", "repair_failed", repairError.message));
      state.turnsSinceLastReflection++;
      return { diagnostics };
    }
    rejection = contractRejectsResponse(envelope, activeContract, state.bank.getAll());
    prepared = rejection ? { rejection, diagnostics: [diagnostic("validation", "rejected", rejection.code, rejection.detail)] } : createProposal(envelope, state, turnOptions, config, contractSnapshot);
    diagnostics.push(...prepared.diagnostics);
    if (prepared.rejection) {
      diagnostics.push(diagnostic("repair", "rejected", "repair_failed", prepared.rejection.detail));
      state.turnsSinceLastReflection++;
      return { diagnostics };
    }
    diagnostics.push(diagnostic("repair", "repaired", "repair_succeeded", "The repaired typed response passed validation."));
  }
  if (repairUsed) diagnostics.push(diagnostic("repair", "repaired", "repair_succeeded", "The repaired typed response passed validation."));
  applyAdvisory(state, envelope);
  state.lastAssistantText = envelope.response.text;
  if (envelope.response.kind === "reflection") state.turnsSinceLastReflection = 0;
  else state.turnsSinceLastReflection++;
  return { response: envelope.response, proposal: prepared.proposal, diagnostics };
}
