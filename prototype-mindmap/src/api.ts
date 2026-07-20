/// <reference types="vite/client" />

import type { MindmapConfig } from "./config";
import { defaultConfig } from "./config";
import type { LLMContext } from "./llm-contract";
import {
  ModelResponseValidationError,
  type AssistantModel,
  type AssistantResponseEnvelope,
  type StructuredRejection,
} from "./assistant-response";
import type { ProposedAction, ProposedRef } from "./action-gateway";
import type { MirrorClaim, MirrorReflection, SourceSpan } from "./types";
import type { SourceBackedOption } from "./assistance-contract";
import {
  CONVERSATIONAL_TEXT_FORMAT,
  MINDMAP_PROVIDER_TOOLS,
  parseResponsesOutput,
  type MindmapToolName,
  type ProviderTransport,
} from "./provider-tools";

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? "http://localhost:8000/api";
const MODEL = (import.meta.env.VITE_MINDMAP_MODEL as string | undefined) ?? "gpt-5.6-terra";
const REASONING_EFFORT = (import.meta.env.VITE_MINDMAP_REASONING_EFFORT as string | undefined) ?? "low";
export const PROVIDER_TRANSPORT: ProviderTransport = import.meta.env.VITE_MINDMAP_PROVIDER_TRANSPORT === "responses_tools" ? "responses_tools" : "chat_json";

export interface OpenAIMessage { role: "system" | "user" | "assistant"; content: string }

async function postChat(messages: OpenAIMessage[]): Promise<string> {
  const response = await fetch(`${BACKEND_URL}/openai/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, reasoning_effort: REASONING_EFFORT, messages, stream: false, response_format: { type: "json_object" } }),
  });
  if (!response.ok) throw new Error(`Backend ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Backend returned an empty model response.");
  return content;
}

interface ResponsesTurnState {
  output?: unknown[];
  toolCallId?: string;
}

async function postResponses(input: unknown[], instructions: string): Promise<unknown> {
  const response = await fetch(`${BACKEND_URL}/openai/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: REASONING_EFFORT },
      instructions,
      input,
      tools: MINDMAP_PROVIDER_TOOLS,
      tool_choice: "auto",
      parallel_tool_calls: false,
      text: { format: CONVERSATIONAL_TEXT_FORMAT },
      store: false,
    }),
  });
  if (!response.ok) throw new Error(`Backend ${response.status}: ${(await response.text()).slice(0, 300)}`);
  return response.json() as Promise<unknown>;
}

export function renderContext(context: LLMContext): string {
  const bank = context.bank.filter((item) => !item.commandOnly && !item.nonHarvestable).map((item) => `[${item.id}] ${item.text}`).join("\n") || "(empty)";
  const map = context.map.thoughtUnits.filter((item) => item.role !== "connection_label").map((item) => `${item.id} ${item.text}${item.parentId ? ` parent=${item.parentId}` : ""}`).join("\n") || "(empty)";
  const candidates = context.candidates.map((item) => `${item.id} ${item.target} ${item.gist} evidence=${item.evidenceUtteranceIds.join(",")}`).join("\n") || "(none)";
  const selection = context.selectedFocus
    ? [
      ...(context.selectedFocus.cards?.map((card) => `${card.ref} ${card.text}`) ?? []),
      ...(context.selectedFocus.draftText ? [`draft selection: ${context.selectedFocus.draftText}`] : []),
    ].join("\n") || "(none)"
    : "(none)";
  const support = context.requestedSupport
    ? `The user explicitly selected the '${context.requestedSupport}' support control. Treat this as advisory steering, not authorization.`
    : "(none)";
  const capabilities = `Can do: ${context.capabilities.canDo.join("; ") || "(none)"}\nCannot do: ${context.capabilities.cantDo.join("; ") || "(none)"}`;
  const pacing = `cards=${context.mapPacing.cardCount}; connections=${context.mapPacing.connectionCount}; sparse=${context.mapPacing.isSparse}. Sparse-map status is a pacing fact only: decide the visible response yourself.`;
  const thinkMap = `value=${context.thinkMapBias} on a 0 (Think) to 100 (Map) control. Use this only to tune conversational eagerness; it never authorizes structure or weakens validation.`;
  const shape = `kind=${context.turnShape.kind}; utterances=${context.turnShape.utteranceCount}; contentTokens=${context.turnShape.contentTokenCount}; characters=${context.turnShape.characterCount}`;
  const reflectionRhythm = `assistant turns since the last reflection=${context.reflectionRhythm.turnsSinceLastReflection}; source-bank entries available=${context.reflectionRhythm.sourceUtteranceCount}. This is calibration only: consider whether another question adds value before asking the user to narrow further.`;
  const proposalOutcome = context.proposalOutcome
    ? `The user ${context.proposalOutcome.decision} a ${context.proposalOutcome.proposalKind === "map_action" ? "map change" : "reflection"}. The map above already reflects any confirmed change. Continue from that state; do not repeat the review request.`
    : "(none)";
  const contract = context.assistanceContract
    ? `${context.assistanceContract.label} (L${context.assistanceContract.level}). Allowed visible kinds: ${context.assistanceContract.allowedResponseKinds.join(", ")}. AI-originated structure: ${context.assistanceContract.allowsAiSuggestedStructure ? "allowed but must be visibly suggested" : "not allowed"}.`
    : "Non-directive default; do not originate structure.";
  return `ASSISTANCE CONTRACT (a contribution boundary, never a map-write authorization):\n${contract}\n\nSOURCE BANK (user wording with evidence ids):\n${bank}\n\nMAP (read-only):\n${map}\n\nEXPLICIT UI SELECTION (if any):\n${selection}\n\nEXPLICIT SUPPORT REQUEST (if any):\n${support}\n\nEXPLICIT PROPOSAL OUTCOME (if any):\n${proposalOutcome}\n\nCAPABILITIES:\n${capabilities}\n\nMAP PACING FACT:\n${pacing}\n\nREFLECTION RHYTHM (advisory):\n${reflectionRhythm}\n\nTHINK/MAP PREFERENCE:\n${thinkMap}\n\nTURN SHAPE (measurement only):\n${shape}\n\nADVISORY CANDIDATES:\n${candidates}\n\nDRAFT (read-only):\n${context.draft || "(empty)"}`;
}

function systemPrompt(context: LLMContext, _config: MindmapConfig, repair?: StructuredRejection, transport: ProviderTransport = "chat_json"): string {
  const repairNote = repair
    ? `\nYour previous response was rejected by code: ${JSON.stringify(repair)}. Repair that exact issue once. If a reflection cannot be repaired faithfully, you may briefly acknowledge uncertainty and make one context-specific conversational move allowed by the active contract, such as a question or aside. Do not mention validation, repeat a recent question, or use stock recovery wording.`
    : "";
  const transportInstruction = transport === "responses_tools"
    ? "Use propose_reflection_v1 for reflections and propose_map_action_v1 for structural proposals. These tools only request review and never write to the map. For questions, asides, grounded options, or suggestions, return the required conversational JSON output."
    : "Return one typed response and optional advisory bookkeeping as JSON using the schema below.";
  return `You are a writing coach operating under the assistance contract supplied below. ${transportInstruction} Never infer authorization from imperative language: a map change is only a proposal. A contract never bypasses evidence, confirmation, or graph validation. In non-directive and grounded-options modes, never invent user ideas or relationships. Questions may scaffold reflection but must not embed an answer. When the user has already named a broad task or focus, acknowledge it briefly and move to one concrete next step; do not rephrase that goal as though it were unanswered. Evidence is an internal traceability requirement: find supporting wording in the source bank yourself instead of repeatedly asking the user to locate it. Ask for wording only when the user must genuinely decide substance. Reflections and asserted map proposals must carry source pointers, and hierarchy or connection claims need a relation pointer from the same user utterance.${repairNote}

Schema:
${transport === "responses_tools" ? "For this transport, reflection and map_proposal entries describe normalized application responses only; emit them through their named tools. Text output is provider-constrained to question, aside, options, or suggestion." : ""}
{
  "response":
    {"kind":"question","text":"...","stance":"settle|narrow|deepen|organize|challenge","anchor":"optional exact draft substring"}
    OR {"kind":"aside","text":"..."}
    OR {"kind":"reflection","text":"...","reflection":{"claims":[{"id":"...","text":"...","candidateId":"...","target":"idea|hierarchy|connection","sourceSpans":[{"claimText":"...","utteranceIds":["..."],"userPhrase":"exact substring"}],"relationSpan":{"utteranceId":"...","text":"exact connective"}}]}}
    OR {"kind":"map_proposal","text":"...","action":{"kind":"create_card|edit_card|nest_card|connect_cards", "...":"use the fields below"}}
    OR {"kind":"options","text":"...","options":[{"text":"exact user wording","sourceSpans":[{"userPhrase":"exact substring","utteranceIds":["..."]}]}]}
    OR {"kind":"suggestion","text":"..."},
  "advisory":{"candidateUpserts":[{"id":"...","target":"idea|hierarchy|connection","gist":"...","addEvidenceIds":["..."]}],"candidateDeletes":["..."],"affect":"exhausted|frustrated|overwhelmed|energized"}
}
Action fields: create_card={text,sourceUtteranceIds}; edit_card={id,text,sourceUtteranceIds}; nest_card={child:{id or text+sourceUtteranceIds},parent:{id or text+sourceUtteranceIds},relationEvidence:{utteranceId,text}}; connect_cards={source:{...},target:{...},labelText,labelSourceUtteranceIds,labelOptions?:[{text,sourceUtteranceIds}],relationEvidence:{utteranceId,text},pairingProof?:{kind:"co_mentioned"|"selection_and_named_card",utteranceId}}. Pairing proof only nominates evidence; code verifies it.
Emit exactly one visible response. Advisory data never authorizes structure or a write.

${renderContext(context)}`;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() ? value.trim() : undefined; }
function stance(value: unknown): "settle" | "narrow" | "deepen" | "organize" | "challenge" | undefined {
  return value === "settle" || value === "narrow" || value === "deepen" || value === "organize" || value === "challenge" ? value : undefined;
}

function parseSpan(value: unknown): SourceSpan | undefined {
  const raw = object(value); const phrase = text(raw?.userPhrase); if (!raw || !phrase) return undefined;
  return { claimText: text(raw.claimText) ?? phrase, utteranceIds: strings(raw.utteranceIds), userPhrase: phrase };
}

function parseReflection(value: unknown): MirrorReflection | undefined {
  const raw = object(value); const items = Array.isArray(raw?.claims) ? raw.claims : [];
  const claims: MirrorClaim[] = items.flatMap((value) => {
    const claim = object(value); const id = text(claim?.id); const claimText = text(claim?.text); if (!claim || !id || !claimText) return [];
    const target = claim.target === "hierarchy" || claim.target === "connection" ? claim.target : "idea";
    const relation = object(claim.relationSpan); const relationText = text(relation?.text); const relationId = text(relation?.utteranceId);
    return [{ id, text: claimText, candidateId: text(claim.candidateId) ?? "unknown", target, sourceSpans: (Array.isArray(claim.sourceSpans) ? claim.sourceSpans : []).map(parseSpan).filter((span): span is SourceSpan => Boolean(span)), ...(relationText && relationId ? { relationSpan: { utteranceId: relationId, text: relationText } } : {}) }];
  });
  return claims.length ? { claims } : undefined;
}

function parseOptions(value: unknown): SourceBackedOption[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const options = value.flatMap((item) => {
    const raw = object(item); const optionText = text(raw?.text);
    if (!raw || !optionText) return [];
    return [{ text: optionText, sourceSpans: (Array.isArray(raw.sourceSpans) ? raw.sourceSpans : []).map(parseSpan).filter((span): span is SourceSpan => Boolean(span)) }];
  });
  return options.length === value.length ? options : undefined;
}

function parseRef(value: unknown): ProposedRef {
  const raw = object(value); return { ...(text(raw?.id) ? { id: text(raw?.id) } : {}), ...(text(raw?.text) ? { text: text(raw?.text) } : {}), sourceUtteranceIds: strings(raw?.sourceUtteranceIds) };
}

function parseAction(value: unknown): ProposedAction | undefined {
  const raw = object(value); if (!raw) return undefined;
  if (raw.kind === "create_card") { const value = text(raw.text); return value ? { kind: "create_card", text: value, sourceUtteranceIds: strings(raw.sourceUtteranceIds) } : undefined; }
  if (raw.kind === "edit_card") { const id = text(raw.id); const value = text(raw.text); return id && value ? { kind: "edit_card", id, text: value, sourceUtteranceIds: strings(raw.sourceUtteranceIds) } : undefined; }
  const relation = object(raw.relationEvidence); const relationText = text(relation?.text); const relationId = text(relation?.utteranceId);
  const relationEvidence = relationText && relationId ? { utteranceId: relationId, text: relationText } : undefined;
  if (raw.kind === "nest_card") return { kind: "nest_card", child: parseRef(raw.child), parent: parseRef(raw.parent), relationEvidence };
  if (raw.kind === "connect_cards") {
    const proof = object(raw.pairingProof); const proofKind = text(proof?.kind); const proofId = text(proof?.utteranceId);
    const pairingProof = proofId && proofKind === "co_mentioned" ? { kind: "co_mentioned" as const, utteranceId: proofId }
      : proofId && proofKind === "selection_and_named_card" ? { kind: "selection_and_named_card" as const, utteranceId: proofId }
        : undefined;
    const labelOptions = Array.isArray(raw.labelOptions) ? raw.labelOptions.map((item) => object(item)).flatMap((option) => {
      const optionText = text(option?.text); return optionText ? [{ text: optionText, sourceUtteranceIds: strings(option?.sourceUtteranceIds) }] : [];
    }) : undefined;
    return { kind: "connect_cards", source: parseRef(raw.source), target: parseRef(raw.target), labelText: text(raw.labelText), labelSourceUtteranceIds: strings(raw.labelSourceUtteranceIds), labelOptions, relationEvidence, pairingProof };
  }
  return undefined;
}

export function parseAssistantResponse(rawValue: unknown): AssistantResponseEnvelope {
  const raw = object(rawValue); const response = object(raw?.response); const kind = response?.kind; const visibleText = text(response?.text);
  if (!raw || !response || !visibleText) throw new Error("invalid_response_envelope");
  let parsed: AssistantResponseEnvelope["response"];
  if (kind === "aside") parsed = { kind, text: visibleText };
  else if (kind === "question") parsed = { kind, text: visibleText, ...(stance(response.stance) ? { stance: stance(response.stance) } : {}), ...(text(response.anchor) ? { anchor: text(response.anchor) } : {}) };
  else if (kind === "reflection") { const reflection = parseReflection(response.reflection); if (!reflection) throw new Error("invalid_reflection_payload"); parsed = { kind, text: visibleText, reflection }; }
  else if (kind === "map_proposal") { const action = parseAction(response.action); if (!action) throw new Error("invalid_map_proposal_payload"); parsed = { kind, text: visibleText, action }; }
  else if (kind === "options") { const options = parseOptions(response.options); if (!options) throw new Error("invalid_options_payload"); parsed = { kind, text: visibleText, options }; }
  else if (kind === "suggestion") parsed = { kind, text: visibleText };
  else throw new Error("unknown_response_kind");
  const advisory = object(raw.advisory);
  return { response: parsed, advisory: advisory ? { candidateUpserts: (Array.isArray(advisory.candidateUpserts) ? advisory.candidateUpserts : []).flatMap((item) => { const next = object(item); const id = text(next?.id); const gist = text(next?.gist); if (!id || !gist) return []; return [{ id, gist, target: next?.target === "hierarchy" || next?.target === "connection" ? next.target : "idea", addEvidenceIds: strings(next?.addEvidenceIds) }]; }), candidateDeletes: strings(advisory.candidateDeletes), ...(typeof advisory.affect === "string" ? { affect: advisory.affect as never } : {}) } : undefined };
}

export interface ConversationMessage { role: "user" | "assistant"; content: string }
export interface ProviderTrace {
  transport: ProviderTransport;
  model: string;
  reasoningEffort: string;
  messages: unknown[];
  parsedProviderResponse: unknown;
  responseId?: string;
  outputItemTypes?: string[];
  toolName?: MindmapToolName;
  toolCallId?: string;
}

/**
 * Create one request's dialogue history. The live UI calls this synchronously
 * before scheduling its state update, so the model cannot receive a transcript
 * which stops at its own unanswered question.
 */
export function historyForCurrentTurn(committed: ConversationMessage[], userText?: string): ConversationMessage[] {
  const history = [...committed];
  if (userText?.trim()) history.push({ role: "user", content: userText });
  return history.slice(-20);
}

export async function callLLM(
  context: LLMContext,
  history: ConversationMessage[],
  config: MindmapConfig = defaultConfig,
  repair?: StructuredRejection,
  onTrace?: (trace: ProviderTrace) => void,
  transport: ProviderTransport = PROVIDER_TRANSPORT,
  responseState?: ResponsesTurnState,
): Promise<AssistantResponseEnvelope> {
  if (transport === "chat_json") {
    const messages: OpenAIMessage[] = [{ role: "system", content: systemPrompt(context, config, repair, transport) }, ...history];
    const rawProviderResponse = await postChat(messages);
    let parsedProviderResponse: unknown;
    try { parsedProviderResponse = JSON.parse(rawProviderResponse) as unknown; }
    catch {
      onTrace?.({ transport, model: MODEL, reasoningEffort: REASONING_EFFORT, messages, parsedProviderResponse: rawProviderResponse });
      throw new ModelResponseValidationError("invalid_provider_json");
    }
    onTrace?.({ transport, model: MODEL, reasoningEffort: REASONING_EFFORT, messages, parsedProviderResponse });
    try { return parseAssistantResponse(parsedProviderResponse); }
    catch (error) {
      if (error instanceof ModelResponseValidationError) throw error;
      throw new ModelResponseValidationError(error instanceof Error ? error.message : "invalid_provider_response");
    }
  }

  const input: unknown[] = history.map((message) => ({ role: message.role, content: message.content }));
  if (repair && responseState?.output?.length) {
    input.push(...responseState.output);
    if (responseState.toolCallId) {
      input.push({ type: "function_call_output", call_id: responseState.toolCallId, output: JSON.stringify({ status: "rejected", rejection: repair }) });
    } else {
      input.push({ role: "user", content: `Repair the rejected response once: ${JSON.stringify(repair)}` });
    }
  }
  const providerResponse = await postResponses(input, systemPrompt(context, config, repair, transport));
  let parsed: ReturnType<typeof parseResponsesOutput>;
  try { parsed = parseResponsesOutput(providerResponse); }
  catch (error) {
    const body = object(providerResponse);
    const rawOutput = Array.isArray(body?.output) ? body.output : [];
    onTrace?.({
      transport, model: MODEL, reasoningEffort: REASONING_EFFORT, messages: input,
      parsedProviderResponse: providerResponse,
      responseId: typeof body?.id === "string" ? body.id : undefined,
      outputItemTypes: rawOutput.map((item) => object(item)?.type).filter((item): item is string => typeof item === "string"),
    });
    throw new ModelResponseValidationError(error instanceof Error ? error.message : "invalid_provider_response");
  }
  if (responseState) {
    responseState.output = parsed.output;
    responseState.toolCallId = parsed.toolCall?.callId;
  }
  onTrace?.({
    transport,
    model: MODEL,
    reasoningEffort: REASONING_EFFORT,
    messages: input,
    parsedProviderResponse: providerResponse,
    responseId: parsed.responseId,
    outputItemTypes: parsed.output.map((item) => object(item)?.type).filter((item): item is string => typeof item === "string"),
    toolName: parsed.toolCall?.name,
    toolCallId: parsed.toolCall?.callId,
  });
  try { return parseAssistantResponse(parsed.rawEnvelope); }
  catch (error) { throw new ModelResponseValidationError(error instanceof Error ? error.message : "invalid_provider_response"); }
}

export function makeLLM(
  config: MindmapConfig | (() => MindmapConfig) = defaultConfig,
  initialHistory: ConversationMessage[] = [],
  onTrace?: (trace: ProviderTrace) => void,
  transport: ProviderTransport = PROVIDER_TRANSPORT,
): AssistantModel {
  const history = initialHistory.slice(-20);
  const responseState: ResponsesTurnState = {};
  return async (context, repair) => {
    const envelope = await callLLM(context, history, typeof config === "function" ? config() : config, repair, onTrace, transport, responseState);
    if (transport === "chat_json") {
      history.push({ role: "assistant", content: envelope.response.text });
      if (history.length > 20) history.splice(0, history.length - 20);
    }
    return envelope;
  };
}
