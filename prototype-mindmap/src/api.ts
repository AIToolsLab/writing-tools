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
import type { GroundedClaim, GroundedRecap, MirrorClaim, MirrorReflection, SourceSpan, TranslationEvidencePhrase } from "./types";
import type { SourceBackedOption } from "./assistance-contract";
import {
  CONVERSATIONAL_TEXT_FORMAT,
  MINDMAP_PROVIDER_TOOLS,
  parseResponsesOutput,
  type MindmapToolName,
  type ProviderTransport,
} from "./provider-tools";

const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
const BACKEND_URL = viteEnv?.VITE_BACKEND_URL ?? "http://localhost:8000/api";
const MODEL = viteEnv?.VITE_MINDMAP_MODEL ?? "gpt-5.6-terra";
const REASONING_EFFORT = viteEnv?.VITE_MINDMAP_REASONING_EFFORT ?? "low";
export const PROVIDER_TRANSPORT: ProviderTransport = viteEnv?.VITE_MINDMAP_PROVIDER_TRANSPORT === "responses_tools" ? "responses_tools" : "chat_json";

/** Runtime transport settings. The browser uses Vite values; the eval runner
 * passes explicit values so importing this module under Node is safe. */
export interface ProviderRuntimeConfig {
  backendUrl?: string;
  model?: string;
  reasoningEffort?: string;
}

function providerRuntime(overrides?: ProviderRuntimeConfig): Required<ProviderRuntimeConfig> {
  return {
    backendUrl: overrides?.backendUrl ?? BACKEND_URL,
    model: overrides?.model ?? MODEL,
    reasoningEffort: overrides?.reasoningEffort ?? REASONING_EFFORT,
  };
}

export interface OpenAIMessage { role: "system" | "user" | "assistant"; content: string }

interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

function providerUsage(value: unknown): ProviderUsage {
  const body = object(value);
  const usage = object(body?.usage);
  const number = (candidate: unknown): number | undefined => typeof candidate === "number" && Number.isFinite(candidate) ? candidate : undefined;
  return {
    inputTokens: number(usage?.input_tokens) ?? number(usage?.prompt_tokens),
    outputTokens: number(usage?.output_tokens) ?? number(usage?.completion_tokens),
    totalTokens: number(usage?.total_tokens),
  };
}

async function postChat(messages: OpenAIMessage[], runtime: Required<ProviderRuntimeConfig>): Promise<{ content: string; body: unknown }> {
  const response = await fetch(`${runtime.backendUrl}/openai/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: runtime.model, reasoning_effort: runtime.reasoningEffort, messages, stream: false, response_format: { type: "json_object" } }),
  });
  if (!response.ok) throw new Error(`Backend ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("Backend returned an empty model response.");
  return { content, body };
}

interface ResponsesTurnState {
  output?: unknown[];
  toolCallId?: string;
}

async function postResponses(input: unknown[], instructions: string, runtime: Required<ProviderRuntimeConfig>): Promise<unknown> {
  const response = await fetch(`${runtime.backendUrl}/openai/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: runtime.model,
      reasoning: { effort: runtime.reasoningEffort },
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
  const bank = context.bank.filter((item) => !item.commandOnly && !item.nonHarvestable).map((item) => `[${item.id}${item.origin === "draft" ? " draft" : ""}] ${item.text}`).join("\n") || "(empty)";
  const map = context.map.thoughtUnits.filter((item) => item.role !== "connection_label").map((item) => `${item.id} ${item.text}${item.parentId ? ` parent=${item.parentId}` : ""}`).join("\n") || "(empty)";
  const candidateLine = (item: LLMContext["candidates"][number]) => `${item.id} target=${item.target} status=${item.status} ageInTurns=${item.ageInTurns}${item.lastRecalledAgeInTurns === undefined ? "" : ` lastRecalledAgeInTurns=${item.lastRecalledAgeInTurns}`} gist=${item.gist} evidence=${item.evidence.map((entry) => `[${entry.utteranceId}] ${JSON.stringify(entry.text)}`).join(" | ") || "(none)"}`;
  const candidates = context.candidates.filter((item) => item.status === "active" || item.status === "parked").map(candidateLine).join("\n") || "(none)";
  const unavailableCandidates = context.candidates.filter((item) => item.status === "ignored" || item.status === "promoted").map(candidateLine).join("\n") || "(none)";
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
  const language = `Interface display locale=${context.language.uiLocale}; this is presentation-only and is not a response-language preference. Latest user language pattern=${context.language.latestUserLanguagePattern}.${context.language.preferredCoachLanguage ? ` Explicit coach-language preference=${context.language.preferredCoachLanguage}.` : ""}`;
  return `ASSISTANCE CONTRACT (a contribution boundary, never a map-write authorization):\n${contract}\n\nLANGUAGE GUIDANCE (advisory, never evidence):\n${language}\n\nSOURCE BANK (user wording with evidence ids):\n${bank}\n\nMAP (read-only):\n${map}\n\nEXPLICIT UI SELECTION (if any):\n${selection}\n\nEXPLICIT SUPPORT REQUEST (if any):\n${support}\n\nEXPLICIT PROPOSAL OUTCOME (if any):\n${proposalOutcome}\n\nCAPABILITIES:\n${capabilities}\n\nMAP PACING FACT:\n${pacing}\n\nREFLECTION RHYTHM (advisory):\n${reflectionRhythm}\n\nTHINK/MAP PREFERENCE:\n${thinkMap}\n\nTURN SHAPE (measurement only):\n${shape}\n\nRECALL-ELIGIBLE CANDIDATES (facts only; you decide whether recall is appropriate):\n${candidates}\n\nDO NOT RECALL OR SURFACE THESE CANDIDATES:\n${unavailableCandidates}\n\nDRAFT (read-only):\n${context.draft || "(empty)"}`;
}

function systemPrompt(context: LLMContext, _config: MindmapConfig, repair?: StructuredRejection, transport: ProviderTransport = "chat_json"): string {
  const repairNote = repair
    ? repair.reflectionRecovery?.stage === "forced_question"
      ? `\nTwo reflection attempts could not stay fully grounded. Here is the accumulated local recovery context: ${JSON.stringify(repair.reflectionRecovery)}. Return exactly one question response now. Ask a natural, targeted question for the specific missing substantive gap. Do not return a reflection or any other response kind, mention validation, repeat a recent question, use generic grilling, or use stock recovery wording.`
      : repair.code === "reflection_validation_failed"
      ? `\nYour previous response was rejected by code: ${JSON.stringify(repair)}. The reflection could not be shown faithfully. Use the included unsupported content words and rejected reflection when available. First try a fully grounded mirror by tightening it so every content word comes from the exact original-language evidence phrases you cite. Do not translate, convert scripts, or modernize quoted evidence. If exact wording would be unnatural or misleading, make one targeted, context-specific question or another contract-allowed conversational move such as an aside. Do not expose validation, repeat a recent question, use generic grilling, or use stock recovery wording.`
      : `\nYour previous response was rejected by code: ${JSON.stringify(repair)}. Repair that exact issue once. If a reflection cannot be repaired faithfully, you may briefly acknowledge uncertainty and make one context-specific conversational move allowed by the active contract, such as a question or aside. Do not mention validation, repeat a recent question, or use stock recovery wording.`
    : "";
  const transportInstruction = transport === "responses_tools"
    ? "Use propose_reflection_v1 for reflections and propose_map_action_v1 for structural proposals. These tools only request review and never write to the map. For questions, asides, grounded recaps, grounded options, suggestions, or explicit translations, return the required conversational JSON output."
    : "Return one typed response and optional advisory bookkeeping as JSON using the schema below.";
  const level = context.assistanceContract?.level ?? 0;
  const levelObjective = level === 2
    ? `L2 SUGGESTIVE OBJECTIVE:
Make a useful, bounded contribution when the user explicitly asks for possibilities, missing angles, your interpretation, or possible connections and the context supports one. A clearly helpful tentative lens may also advance an unresolved choice, but do not treat every broad request for help or draft feedback as a request for new content. Preserve an explicit selected passage and an already-established conversational focus; do not replace either with a more interesting model-chosen focus. The goal is a meaningful difference from L0 at relevant opportunities, not a high frequency of suggestions. Put every new lens, concept, relationship, or direction in a suggestion or an AI-originated map proposal, never inside a reflection or the premise of a question. A conversational suggestion must begin with "AI suggestion:" and present the addition as tentative, not as what the user already thinks. After clearly attributing it, you may invite the user to accept, reject, or reshape it. A question remains appropriate when the missing substance genuinely belongs to the user.`
    : level === 1
    ? `L1 GROUNDED-OPTIONS OBJECTIVE:
Help the user compare or organize possibilities already present in eligible user wording. Options must remain verbatim-grounded. Do not add a new lens, relationship, priority, or direction, including through a question's premise.`
    : `L0 NON-DIRECTIVE OBJECTIVE:
Increase clarity while preserving the user's conceptual freedom. Do not supply an umbrella concept, interpretation, causal or hierarchical relationship, priority, diagnosis, or direction the user has not stated, including as a presupposition inside a question. Prefer a faithful reflection when the user's meaning is already expressible in their words; otherwise ask one open, gap-filling question. A direct request for help does not authorize you to choose the answer. A map proposal is appropriate only when the user has already supplied the exact content and any claimed relationship.`;
  return `You are a writing coach operating under the assistance contract supplied below. ${transportInstruction} Never infer authorization from imperative language: a map change is only a proposal. A contract never bypasses evidence, confirmation, or graph validation.

${levelObjective}

EXPLICIT TRANSLATION:
Only emit a translation response when the user directly asks you to translate. Treat that as a separate, visibly AI-authored service, never as a mirror, recap, suggestion, or map action. Select the exact original-language phrase or phrases being translated and identify each with sourceEvidence; preserve their original wording in the Source Bank and model context. Put the translated output only in translatedText, set provenance to "ai_translated", and name the requested targetLanguage. Do not create candidates, a proposal, a card, a relationship, or an adoption path from a translation. Do not translate proactively, and do not use translation to make evidence appear grounded.

QUESTION FRAMING CHECK:
A question is also a form of framing. Before emitting one, inspect every substantive concept, relationship, assumption, candidate answer, and direction it contains. If the user has not stated that material and it is not established in the confirmed map, do not smuggle it into the question. At L0/L1, remove it and ask about the genuine gap using the user's concepts. At L2, if the material would be a useful contribution, move it into an explicitly attributed suggestion; otherwise remove it. Do not turn an unstated answer into a forced choice. Use direct quotation only when it makes the referent clearer, and integrate quoted wording into a natural, understandable sentence. A fragment or pronoun copied exactly can still make a question confusing; name the user's established topic plainly without adding a substantive premise. Do not force the user to unpack a list of words one by one when a synthesis or broader gap is the useful next move. For example, after separate statements about visibility and redistribution, "Why does visibility lead to redistribution?" falsely assumes a relationship. L0 can ask, "How, if at all, do visibility and redistribution belong together for you?" L2 can instead say, "AI suggestion: visibility might be a condition for redistribution rather than the same change. Does that fit, or would you frame their relationship differently?"

SHARED AUTHORSHIP AND GROUNDING:
In non-directive and grounded-options modes, never invent user ideas or relationships. Questions may scaffold reflection but must not embed an answer. When the user has already named a broad task or focus, acknowledge it briefly and move to one concrete next step; do not rephrase that goal as though it were unanswered. Treat the full draft as background context and a user selection as explicit focus. Use the user's request, recent dialogue, and draft to judge the most useful next move. When passage choice is materially ambiguous, invite the user to choose. Use draft anchors selectively, and distinguish model-chosen anchors from user-selected focus. Include an anchor only when it is useful and copied as one exact contiguous substring from DRAFT; otherwise omit it. Evidence is an internal traceability requirement: find supporting wording in the source bank yourself instead of repeatedly asking the user to locate it. Ask for wording only when the user must genuinely decide substance. Preserve authored passages and quoted evidence in their original language. The interface display locale is never an instruction to translate or change reply language. Normally reply in the latest user turn's language pattern; a mixed-language turn may receive a natural mixed-language reply. Honor a direct user request for another response language, but never silently translate quoted evidence. When the pattern is unknown, follow the original conversation naturally rather than guessing. When the user explicitly instructs you to nest one referenced card in another, propose that nesting instead of asking them to restate a semantic relationship; cite the complete current-turn instruction containing both card references as relationEvidence. This explicit intent authorizes only the proposed nesting and still requires confirmation. Every reflection and grounded recap at every assistance level must be strictly user-word-faithful: reuse only content words from the exact original-language userPhrase evidence it cites, though ordinary English function words and the closed Chinese particle class may serve as glue. Never translate substantive evidence inside a mirror. Use a grounded recap when conversational consolidation is useful but map capture is not the current move; reserve a reflection for claims the user will be invited to confirm, revise, or decline for possible map placement. A grounded recap is conversational synthesis only: it is visibly labeled as a recap, creates no proposal, and must not nominate candidates merely to make itself capturable. At L0, a grounded recap may restate only the current user turn, and a reflection may draw from only one recorded user moment. At L1 and L2, a recap or reflection may bring together eligible user wording across turns; code records the resulting selection as AI-connected even though the words remain the user's. A recap may also include current draft wording when chat wording anchors the juxtaposition. This selection is an AI conversational move, but every substantive word and any asserted relationship must remain supported by the cited user evidence. Each reflection claim's candidateId must name an existing active or parked candidate shown in context or a valid candidateUpsert with the same id in this envelope. When a new grounded reflection claim has no existing candidate, include that same-id upsert with its eligible evidence ids; never invent a dangling candidateId or reuse an ignored or promoted candidate. At L1 and L2, you may cite an exact draft-labelled passage to juxtapose it with chat wording; the connection is AI-selected but the words remain the user's. At L0, do not cite draft evidence. Never invent a relationship between separate chat and draft passages; use a suggestion at L2 for novel interpretation. Put any novel L2 language in an explicitly AI-attributed suggestion or map proposal, never a reflection or grounded recap. Reflections, grounded recaps, and asserted map proposals must carry source pointers, and hierarchy or connection claims need a relation pointer from the same user utterance. For a large or abstract turn, when a complete grounded mirror is not yet possible, favor one focusing question over arbitrarily collapsing it into one claim or presenting a proposal. This is conversational judgment, not a fixed response rule. Candidate age is a fact, never a command to recall. Recall only when it helps the current conversation, only from active or parked candidates, and only as a question or aside carrying an exact user phrase in a recall annotation. Never recall ignored or promoted candidates. Do not echo unchanged candidates in advisory bookkeeping.${repairNote}

Schema:
${transport === "responses_tools" ? "For this transport, reflection and map_proposal entries describe normalized application responses only; emit them through their named tools. Text output is provider-constrained to question, aside, grounded_recap, options, suggestion, or translation." : ""}
{
  "response":
    {"kind":"question","text":"...","stance":"settle|narrow|deepen|organize|challenge","anchor":"optional exact draft substring","recall":{"candidateId":"...","sourceUtteranceId":"...","userPhrase":"exact substring"}|null}
    OR {"kind":"aside","text":"...","recall":{"candidateId":"...","sourceUtteranceId":"...","userPhrase":"exact substring"}|null}
    OR {"kind":"reflection","text":"...","reflection":{"claims":[{"id":"...","text":"...","candidateId":"...","target":"idea|hierarchy|connection","sourceSpans":[{"claimText":"...","utteranceIds":["..."],"userPhrase":"exact substring"}],"relationSpan":{"utteranceId":"...","text":"exact connective"}}]}}
    OR {"kind":"grounded_recap","text":"...","recap":{"claims":[{"id":"...","text":"...","target":"idea|hierarchy|connection","sourceSpans":[{"claimText":"...","utteranceIds":["..."],"userPhrase":"exact substring"}],"relationSpan":{"utteranceId":"...","text":"exact connective"}}]}}
    OR {"kind":"map_proposal","text":"...","candidateId":"linked candidate or null","action":{"kind":"create_card|edit_card|nest_card|connect_cards", "...":"use the fields below"}}
    OR {"kind":"options","text":"...","options":[{"text":"exact user wording","sourceSpans":[{"userPhrase":"exact substring","utteranceIds":["..."]}]}]}
    OR {"kind":"suggestion","text":"..."},
    OR {"kind":"translation","sourceEvidence":[{"utteranceIds":["..."],"userPhrase":"exact original-language phrase"}],"targetLanguage":"...","translatedText":"...","provenance":"ai_translated"},
  "advisory":{"candidateUpserts":[{"id":"...","target":"idea|hierarchy|connection","gist":"...","addEvidenceIds":["..."],"status":"active|parked"}],"affect":"exhausted|frustrated|overwhelmed|energized"}
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

function parseRecall(value: unknown): import("./assistant-response").RecallAnnotation | undefined {
  const raw = object(value);
  const candidateId = text(raw?.candidateId);
  const sourceUtteranceId = text(raw?.sourceUtteranceId);
  const userPhrase = text(raw?.userPhrase);
  return candidateId && sourceUtteranceId && userPhrase ? { candidateId, sourceUtteranceId, userPhrase } : undefined;
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

function parseGroundedRecap(value: unknown): GroundedRecap | undefined {
  const raw = object(value); const items = Array.isArray(raw?.claims) ? raw.claims : [];
  const claims: GroundedClaim[] = items.flatMap((value) => {
    const claim = object(value); const id = text(claim?.id); const claimText = text(claim?.text); if (!claim || !id || !claimText) return [];
    const target = claim.target === "hierarchy" || claim.target === "connection" ? claim.target : "idea";
    const relation = object(claim.relationSpan); const relationText = text(relation?.text); const relationId = text(relation?.utteranceId);
    return [{ id, text: claimText, target, sourceSpans: (Array.isArray(claim.sourceSpans) ? claim.sourceSpans : []).map(parseSpan).filter((span): span is SourceSpan => Boolean(span)), ...(relationText && relationId ? { relationSpan: { utteranceId: relationId, text: relationText } } : {}) }];
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

/** A display-only reader translation request. Its result is never session data. */
export async function translateReaderText(text: string, targetLanguage: string): Promise<string> {
  const response = await postChat([
    { role: "system", content: `Translate the supplied display text into ${targetLanguage}. Return JSON only: {"translation":"..."}. Preserve [[[number]]] markers exactly; do not explain, add content, or translate them.` },
    { role: "user", content: text },
  ], providerRuntime());
  const parsed = JSON.parse(response.content) as { translation?: unknown };
  if (typeof parsed.translation !== "string") throw new Error("Translation response was missing translation text.");
  return parsed.translation;
}

function parseTranslationEvidence(value: unknown): TranslationEvidencePhrase[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const evidence = value.flatMap((item) => {
    const raw = object(item);
    const userPhrase = text(raw?.userPhrase);
    const utteranceIds = strings(raw?.utteranceIds);
    return userPhrase && utteranceIds.length ? [{ userPhrase, utteranceIds }] : [];
  });
  return evidence.length === value.length ? evidence : undefined;
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
  const raw = object(rawValue); const response = object(raw?.response); const kind = response?.kind;
  const translatedText = text(response?.translatedText);
  const visibleText = text(response?.text) ?? (kind === "translation" ? translatedText : undefined);
  if (!raw || !response || !visibleText) throw new Error("invalid_response_envelope");
  let parsed: AssistantResponseEnvelope["response"];
  const recall = parseRecall(response.recall);
  if (response.recall !== undefined && response.recall !== null && !recall) throw new Error("invalid_recall_payload");
  if (kind !== "question" && kind !== "aside" && response.recall !== undefined && response.recall !== null) throw new Error("invalid_recall_kind");
  if (kind === "aside") parsed = { kind, text: visibleText, ...(recall ? { recall } : {}) };
  else if (kind === "question") parsed = { kind, text: visibleText, ...(stance(response.stance) ? { stance: stance(response.stance) } : {}), ...(text(response.anchor) ? { anchor: text(response.anchor) } : {}), ...(recall ? { recall } : {}) };
  else if (kind === "reflection") { const reflection = parseReflection(response.reflection); if (!reflection) throw new Error("invalid_reflection_payload"); parsed = { kind, text: visibleText, reflection }; }
  else if (kind === "grounded_recap") { const recap = parseGroundedRecap(response.recap); if (!recap) throw new Error("invalid_grounded_recap_payload"); parsed = { kind, text: visibleText, recap }; }
  else if (kind === "map_proposal") { const action = parseAction(response.action); if (!action) throw new Error("invalid_map_proposal_payload"); if (response.candidateId !== undefined && response.candidateId !== null && !text(response.candidateId)) throw new Error("invalid_map_candidate_id"); parsed = { kind, text: visibleText, action, ...(text(response.candidateId) ? { candidateId: text(response.candidateId) } : {}) }; }
  else if (kind === "options") { const options = parseOptions(response.options); if (!options) throw new Error("invalid_options_payload"); parsed = { kind, text: visibleText, options }; }
  else if (kind === "suggestion") parsed = { kind, text: visibleText };
  else if (kind === "translation") {
    const sourceEvidence = parseTranslationEvidence(response.sourceEvidence);
    const targetLanguage = text(response.targetLanguage);
    if (!sourceEvidence || !targetLanguage || !translatedText || response.provenance !== "ai_translated") throw new Error("invalid_translation_payload");
    if (response.text !== undefined && text(response.text) !== translatedText) throw new Error("invalid_translation_text");
    parsed = { kind, text: translatedText, sourceEvidence, targetLanguage, translatedText, provenance: "ai_translated" };
  }
  else throw new Error("unknown_response_kind");
  const advisory = object(raw.advisory);
  return { response: parsed, advisory: advisory ? { candidateUpserts: (Array.isArray(advisory.candidateUpserts) ? advisory.candidateUpserts : []).flatMap((item) => { const next = object(item); const id = text(next?.id); const gist = text(next?.gist); if (!id || !gist || (next?.status !== undefined && next.status !== "active" && next.status !== "parked")) return []; return [{ id, gist, target: next?.target === "hierarchy" || next?.target === "connection" ? next.target : "idea", addEvidenceIds: strings(next?.addEvidenceIds), status: next?.status === "parked" ? "parked" as const : "active" as const }]; }), ...(typeof advisory.affect === "string" ? { affect: advisory.affect as never } : {}) } : undefined };
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
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  structuredResponseOutcome: "accepted" | "rejected";
  toolArgumentOutcome: "accepted" | "rejected" | "not_applicable";
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
  runtimeOverrides?: ProviderRuntimeConfig,
): Promise<AssistantResponseEnvelope> {
  const runtime = providerRuntime(runtimeOverrides);
  if (transport === "chat_json") {
    const messages: OpenAIMessage[] = [{ role: "system", content: systemPrompt(context, config, repair, transport) }, ...history];
    const startedAt = Date.now();
    const chatResponse = await postChat(messages, runtime);
    const durationMs = Date.now() - startedAt;
    const rawProviderResponse = chatResponse.content;
    const usage = providerUsage(chatResponse.body);
    let parsedProviderResponse: unknown;
    try { parsedProviderResponse = JSON.parse(rawProviderResponse) as unknown; }
    catch {
      onTrace?.({ transport, model: runtime.model, reasoningEffort: runtime.reasoningEffort, messages, parsedProviderResponse: rawProviderResponse, durationMs, structuredResponseOutcome: "rejected", toolArgumentOutcome: "not_applicable", ...usage });
      throw new ModelResponseValidationError("invalid_provider_json");
    }
    try {
      const envelope = parseAssistantResponse(parsedProviderResponse);
      onTrace?.({ transport, model: runtime.model, reasoningEffort: runtime.reasoningEffort, messages, parsedProviderResponse, durationMs, structuredResponseOutcome: "accepted", toolArgumentOutcome: "not_applicable", ...usage });
      return envelope;
    }
    catch (error) {
      onTrace?.({ transport, model: runtime.model, reasoningEffort: runtime.reasoningEffort, messages, parsedProviderResponse, durationMs, structuredResponseOutcome: "rejected", toolArgumentOutcome: "not_applicable", ...usage });
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
  const startedAt = Date.now();
  const providerResponse = await postResponses(input, systemPrompt(context, config, repair, transport), runtime);
  const durationMs = Date.now() - startedAt;
  const usage = providerUsage(providerResponse);
  let parsed: ReturnType<typeof parseResponsesOutput>;
  try { parsed = parseResponsesOutput(providerResponse); }
  catch (error) {
    const body = object(providerResponse);
    const rawOutput = Array.isArray(body?.output) ? body.output : [];
    const code = error instanceof Error ? error.message : "invalid_provider_response";
    onTrace?.({
      transport, model: runtime.model, reasoningEffort: runtime.reasoningEffort, messages: input,
      parsedProviderResponse: providerResponse,
      responseId: typeof body?.id === "string" ? body.id : undefined,
      outputItemTypes: rawOutput.map((item) => object(item)?.type).filter((item): item is string => typeof item === "string"),
      durationMs,
      structuredResponseOutcome: "rejected",
      toolArgumentOutcome: code === "invalid_provider_tool_arguments" ? "rejected" : "not_applicable",
      ...usage,
    });
    throw new ModelResponseValidationError(code);
  }
  if (responseState) {
    responseState.output = parsed.output;
    responseState.toolCallId = parsed.toolCall?.callId;
  }
  const trace = {
    transport,
    model: runtime.model,
    reasoningEffort: runtime.reasoningEffort,
    messages: input,
    parsedProviderResponse: providerResponse,
    responseId: parsed.responseId,
    outputItemTypes: parsed.output.map((item) => object(item)?.type).filter((item): item is string => typeof item === "string"),
    toolName: parsed.toolCall?.name,
    toolCallId: parsed.toolCall?.callId,
    durationMs,
    toolArgumentOutcome: parsed.toolCall ? "accepted" as const : "not_applicable" as const,
    ...usage,
  };
  try {
    const envelope = parseAssistantResponse(parsed.rawEnvelope);
    onTrace?.({ ...trace, structuredResponseOutcome: "accepted" });
    return envelope;
  }
  catch (error) {
    onTrace?.({ ...trace, structuredResponseOutcome: "rejected" });
    throw new ModelResponseValidationError(error instanceof Error ? error.message : "invalid_provider_response");
  }
}

export function makeLLM(
  config: MindmapConfig | (() => MindmapConfig) = defaultConfig,
  initialHistory: ConversationMessage[] = [],
  onTrace?: (trace: ProviderTrace) => void,
  transport: ProviderTransport = PROVIDER_TRANSPORT,
  runtimeOverrides?: ProviderRuntimeConfig,
): AssistantModel {
  const history = initialHistory.slice(-20);
  const responseState: ResponsesTurnState = {};
  return async (context, repair) => {
    const envelope = await callLLM(context, history, typeof config === "function" ? config() : config, repair, onTrace, transport, responseState, runtimeOverrides);
    if (transport === "chat_json") {
      history.push({ role: "assistant", content: envelope.response.text });
      if (history.length > 20) history.splice(0, history.length - 20);
    }
    return envelope;
  };
}
