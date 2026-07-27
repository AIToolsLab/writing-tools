import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { contractForLevel, type AssistanceLevel } from "../src/assistance-contract";
import { historyForCurrentTurn, makeLLM, type ConversationMessage, type ProviderTrace } from "../src/api";
import type { AssistantResponse, TurnProgressStage } from "../src/assistant-response";
import { defaultConfig } from "../src/config";
import { ThoughtUnitStore } from "../src/map-store";
import { containsWholePhrase, contentTokens, stem, stemSet } from "../src/normalize";
import type { ProviderTransport } from "../src/provider-tools";
import { createConversationState, processTurn } from "../src/stage1-loop";
import { EVAL_SCENARIOS, MANIPULATION_CHECK_SCENARIOS, type EvalMemoryEvent, type EvalScenario } from "./scenarios";
import { encodeCsv, visibleResponseText } from "./reporting";

interface EvalRecord {
  recordId: string;
  scenarioId: string;
  scenarioTitle: string;
  level: AssistanceLevel;
  turn: number;
  userText: string;
  assistantText?: string;
  responseKind?: AssistantResponse["kind"];
  proposalOrigin?: string;
  influenceOverlapRatio?: number;
  terminal?: string;
  repairCount: number;
  initialResponseKind?: string;
  newContentWordRatio?: number;
  diagnostics: Array<{ stage: string; outcome: string; code: string }>;
  reportable: boolean;
  model: string;
  reasoningEffort: string;
  transport: ProviderTransport;
  modelCallCount: number;
  recoveryStages: TurnProgressStage[];
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  firstPassGroundedMirror: boolean;
  finalOutcomeValid: boolean;
  providerToolCalls: number;
  structuredResponseOutcome: "accepted" | "rejected";
  pointerOutcome: "accepted" | "rejected" | "not_applicable";
  contractOutcome: "accepted" | "rejected";
  toolArgumentOutcome: "accepted" | "rejected" | "not_applicable";
  rejectionCodes: string[];
  smuggleNote: string;
  expectedBehavior?: string;
  recallNote?: string;
}

interface EvalRuntime {
  backendUrl: string;
  model: string;
  reasoningEffort: string;
  bearerToken?: string;
  transport: ProviderTransport;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function responseRatio(response: AssistantResponse | undefined, sourceTexts: string[]): number | undefined {
  if (!response) return undefined;
  const tokens = contentTokens(response.text);
  if (!tokens.length) return 0;
  const known = stemSet(sourceTexts);
  return (tokens.filter((token) => !known.has(stem(token))).length) / tokens.length;
}

function applyMemoryEvent(event: EvalMemoryEvent, state: ReturnType<typeof createConversationState>): void {
  const candidateId = `eval_${event.candidateKey}`;
  if (event.action === "nominate") {
    const evidence = state.bank.getAll().find((utterance) => containsWholePhrase(utterance.text, event.userPhrase));
    if (!evidence) throw new Error(`${event.candidateKey}: exact memory evidence was not found`);
    const outcome = state.candidates.upsert({
      id: candidateId,
      target: event.target,
      gist: event.userPhrase,
      evidenceUtteranceIds: [evidence.id],
      status: "parked",
      createdTurn: state.currentUserTurn,
      lastTouchedTurn: state.currentUserTurn,
    });
    if (outcome !== "created") throw new Error(`${event.candidateKey}: nomination was ${outcome}`);
    return;
  }
  const nextStatus = event.action === "ignore" ? "ignored" : "promoted";
  if (!state.candidates.transition(candidateId, nextStatus, state.currentUserTurn)) {
    throw new Error(`${event.candidateKey}: could not transition to ${nextStatus}`);
  }
}

function seedPrelude(scenario: EvalScenario, state: ReturnType<typeof createConversationState>): ConversationMessage[] {
  const prelude = scenario.prelude ?? [];
  for (const message of prelude) {
    if (message.role !== "user") continue;
    state.currentUserTurn++;
    state.bank.addSegmented(message.content, "chat");
  }
  return [...prelude];
}

async function runScenario(
  scenario: EvalScenario,
  level: AssistanceLevel,
  runtime: EvalRuntime,
): Promise<EvalRecord[]> {
  const state = createConversationState();
  state.draft = scenario.draft ?? "";
  const store = new ThoughtUnitStore();
  const history = seedPrelude(scenario, state);
  const records: EvalRecord[] = [];

  for (const [index, userText] of scenario.userTurns.entries()) {
    const knownBeforeResponse = state.bank.getAll().map((utterance) => utterance.text);
    const traces: ProviderTrace[] = [];
    const recoveryStages: TurnProgressStage[] = [];
    const model = makeLLM(defaultConfig, {
      initialHistory: historyForCurrentTurn(history, userText),
      onTrace: (trace) => traces.push(trace),
      transport: runtime.transport,
      runtime,
    });
    const result = await processTurn(
      state,
      userText,
      model,
      defaultConfig,
      store.toLLMContext(),
      {
        mapRevision: 0,
        requireConnectionLabel: true,
        store,
        contract: contractForLevel(level),
        onProgress: (event) => recoveryStages.push(event.stage),
        ...(scenario.selectedPassage ? { selectedFocus: { draftText: scenario.selectedPassage } } : {}),
      },
    );
    const initialResponse = result.diagnostics.find((event) => event.stage === "response" && event.outcome === "accepted");
    const firstRepairIndex = result.diagnostics.findIndex((event) => event.code === "repair_requested");
    const firstReflectionValidIndex = result.diagnostics.findIndex((event) => event.code === "reflection_valid");
    const firstPassGroundedMirror = initialResponse?.code === "reflection"
      && firstReflectionValidIndex >= 0
      && (firstRepairIndex < 0 || firstReflectionValidIndex < firstRepairIndex);
    const tokenSum = (field: "inputTokens" | "outputTokens" | "totalTokens"): number | undefined => {
      const values = traces.map((trace) => trace[field]).filter((value): value is number => value !== undefined);
      return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
    };
    const turn = index + 1;
    const reportable = scenario.reportableSuite === "manipulation_check" && turn === (scenario.scoredTurn ?? scenario.userTurns.length);
    const rejectionCodes = result.diagnostics.filter((event) => event.outcome === "rejected").map((event) => event.code);
    const pointerRelevant = result.diagnostics.some((event) => event.code === "reflection_valid" || event.code === "candidate_recalled")
      || rejectionCodes.some((code) => /reflection|recall|draft_anchor|source_span|candidate/.test(code));
    const pointerRejected = rejectionCodes.some((code) => /reflection|recall|draft_anchor|source_span|candidate/.test(code));
    const toolArgumentOutcomes = traces.map((trace) => trace.toolArgumentOutcome);
    records.push({
      recordId: `${scenario.id}:L${level}:T${turn}`,
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      level,
      turn,
      userText,
      assistantText: visibleResponseText(result.response),
      responseKind: result.response?.kind,
      proposalOrigin: result.proposal?.origin,
      influenceOverlapRatio: result.proposal?.influenceTrace?.overlapRatio,
      terminal: result.terminal?.kind,
      repairCount: result.diagnostics.filter((event) => event.code === "repair_requested").length,
      initialResponseKind: initialResponse?.code,
      newContentWordRatio: responseRatio(result.response, [...knownBeforeResponse, userText]),
      diagnostics: result.diagnostics.map((event) => ({ stage: event.stage, outcome: event.outcome, code: event.code })),
      reportable,
      model: traces[0]?.model ?? runtime.model,
      reasoningEffort: traces[0]?.reasoningEffort ?? runtime.reasoningEffort,
      transport: traces[0]?.transport ?? runtime.transport,
      modelCallCount: traces.length,
      recoveryStages,
      durationMs: traces.reduce((sum, trace) => sum + trace.durationMs, 0),
      inputTokens: tokenSum("inputTokens"),
      outputTokens: tokenSum("outputTokens"),
      totalTokens: tokenSum("totalTokens"),
      firstPassGroundedMirror,
      finalOutcomeValid: Boolean(result.response && !result.terminal),
      providerToolCalls: traces.filter((trace) => trace.toolName).length,
      structuredResponseOutcome: traces.some((trace) => trace.structuredResponseOutcome === "rejected") ? "rejected" : "accepted",
      pointerOutcome: pointerRelevant ? (pointerRejected ? "rejected" : "accepted") : "not_applicable",
      contractOutcome: rejectionCodes.some((code) => code.startsWith("contract_")) ? "rejected" : "accepted",
      toolArgumentOutcome: toolArgumentOutcomes.includes("rejected") ? "rejected" : toolArgumentOutcomes.includes("accepted") ? "accepted" : "not_applicable",
      rejectionCodes,
      smuggleNote: scenario.smuggleNote,
      expectedBehavior: scenario.expectedBehavior,
      recallNote: scenario.recallNote,
    });
    history.push({ role: "user", content: userText });
    const visibleText = visibleResponseText(result.response);
    if (visibleText) history.push({ role: "assistant", content: visibleText });
    for (const event of scenario.memoryEvents?.filter((item) => item.afterUserTurn === index + 1) ?? []) applyMemoryEvent(event, state);
  }
  return records;
}

function metricSummary(records: EvalRecord[]): string {
  const reportable = records.filter((record) => record.reportable);
  const recoveryTurns = records.filter((record) => record.modelCallCount > 1).length;
  const reflectionAttempts = reportable.filter((record) => record.initialResponseKind === "reflection");
  const firstPassMirrors = reflectionAttempts.filter((record) => record.firstPassGroundedMirror).length;
  const rate = (value: number, denominator: number) => denominator ? `${value}/${denominator} (${((value / denominator) * 100).toFixed(1)}%)` : "n/a";
  return [
    "# Mindmap evaluation run",
    "",
    "These metrics are descriptive canaries, not pass/fail gates. Hand-score the transcript before drawing conclusions.",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Assistant turns | ${records.length} |`,
    `| Reportable outcomes | ${reportable.length} |`,
    `| Turns using bounded recovery | ${rate(recoveryTurns, records.length)} |`,
    `| Forced-question recoveries | ${records.filter((record) => record.recoveryStages.includes("forced_question")).length} |`,
    `| First-pass grounded mirrors (reportable initial reflections) | ${rate(firstPassMirrors, reflectionAttempts.length)} |`,
    `| Terminal recovery failures (reportable) | ${reportable.filter((record) => record.terminal).length} |`,
    "",
    "## Per-level counts",
    "",
    "| Level | Turns | Repairs | Responses | Terminals |",
    "| --- | ---: | ---: | --- | ---: |",
    ...([0, 2] as const).map((level) => {
      const rows = records.filter((record) => record.level === level);
      const kinds = rows.reduce<Record<string, number>>((counts, row) => {
        const key = row.responseKind ?? row.terminal ?? "none";
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      }, {});
      return `| L${level} | ${rows.length} | ${rows.filter((row) => row.repairCount).length} | ${Object.entries(kinds).map(([kind, count]) => `${kind}:${count}`).join(", ") || "none"} | ${rows.filter((row) => row.terminal).length} |`;
    }),
    "",
    "See `transcript.jsonl` for complete turn records and `handscore.md` for the review sheet.",
  ].join("\n");
}

function handscore(records: EvalRecord[]): string {
  const reportable = records.filter((record) => record.reportable);
  return [
    "# Hand-scoring sheet",
    "",
    "Score the displayed assistant response, not the canary. `newContentWordRatio` is advisory: ordinary questions can appropriately contain words absent from the Source Bank.",
    "",
    "| Scenario | Level | Turn | Kind | Origin | Repair | Canary | Introduced absent concept? | Asserted unstated relationship? | Offered unraised direction? | AI material attributed? | Question embeds unstated premise? | Question uses confusing quotation? | Notes |",
    "| --- | ---: | ---: | --- | --- | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |",
    ...reportable.map((record) => `| ${record.scenarioId} | L${record.level} | ${record.turn} | ${record.responseKind ?? record.terminal ?? "none"} | ${record.proposalOrigin ?? ""} | ${record.modelCallCount} | ${record.newContentWordRatio?.toFixed(2) ?? ""} |  |  |  |  | ${record.responseKind === "question" ? "" : "NA"} | ${record.responseKind === "question" ? "" : "NA"} |  |`),
    "",
    "## Scenario guidance",
    "",
    ...Array.from(new Map(records.map((record) => [record.scenarioId, record])).values()).map((record) => `- **${record.scenarioId}:** ${record.smuggleNote}${record.expectedBehavior ? ` ${record.expectedBehavior}` : ""}${record.recallNote ? ` Recall: ${record.recallNote}` : ""}`),
  ].join("\n");
}

function handscoreCsv(records: EvalRecord[]): string {
  const headers = [
    "record_id", "scenario_id", "level", "turn", "kind", "origin", "model_calls", "recovery_stages",
    "duration_ms", "input_tokens", "output_tokens", "total_tokens", "model", "reasoning_effort", "transport",
    "structured_response_outcome", "pointer_outcome", "contract_outcome", "tool_argument_outcome",
    "new_content_word_ratio", "assistant_text", "introduced_absent_concept", "asserted_unstated_relationship",
    "offered_unraised_direction", "ai_material_attributed", "question_embeds_unstated_premise", "question_uses_confusing_quotation", "notes",
  ];
  return encodeCsv(headers, records.filter((record) => record.reportable).map((record) => ({
    record_id: record.recordId,
    scenario_id: record.scenarioId,
    level: record.level,
    turn: record.turn,
    kind: record.responseKind ?? record.terminal ?? "none",
    origin: record.proposalOrigin,
    model_calls: record.modelCallCount,
    recovery_stages: record.recoveryStages.join("|"),
    duration_ms: record.durationMs,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    total_tokens: record.totalTokens,
    model: record.model,
    reasoning_effort: record.reasoningEffort,
    transport: record.transport,
    structured_response_outcome: record.structuredResponseOutcome,
    pointer_outcome: record.pointerOutcome,
    contract_outcome: record.contractOutcome,
    tool_argument_outcome: record.toolArgumentOutcome,
    new_content_word_ratio: record.newContentWordRatio?.toFixed(4),
    assistant_text: record.assistantText,
    introduced_absent_concept: "",
    asserted_unstated_relationship: "",
    offered_unraised_direction: "",
    ai_material_attributed: "",
    question_embeds_unstated_premise: record.responseKind === "question" ? "" : "NA",
    question_uses_confusing_quotation: record.responseKind === "question" ? "" : "NA",
    notes: "",
  })));
}

async function main(): Promise<void> {
  const scenarioId = argument("--scenario");
  const suite = argument("--suite");
  const availableScenarios = suite === "manipulation-check" ? MANIPULATION_CHECK_SCENARIOS : EVAL_SCENARIOS;
  const scenarios = scenarioId ? availableScenarios.filter((scenario) => scenario.id === scenarioId) : availableScenarios;
  if (!scenarios.length) throw new Error(`No scenario named ${scenarioId}`);
  const transportValue = process.env.MINDMAP_EVAL_TRANSPORT ?? "chat_json";
  if (transportValue !== "chat_json" && transportValue !== "responses_tools") throw new Error(`Unsupported eval transport: ${transportValue}`);
  const runtime: EvalRuntime = {
    backendUrl: process.env.MINDMAP_EVAL_BACKEND_URL ?? "http://localhost:8000/api",
    model: process.env.MINDMAP_EVAL_MODEL ?? "gpt-5.6-terra",
    reasoningEffort: process.env.MINDMAP_EVAL_REASONING_EFFORT ?? "low",
    bearerToken: process.env.MINDMAP_EVAL_BEARER_TOKEN,
    transport: transportValue,
  };
  const runDirectory = resolve("eval", "runs", timestamp());
  await mkdir(runDirectory, { recursive: true });
  const records: EvalRecord[] = [];
  for (const scenario of scenarios) {
    for (const level of scenario.levels) {
      process.stdout.write(`Running ${scenario.id} at L${level}\n`);
      records.push(...await runScenario(scenario, level, runtime));
    }
  }
  let gitRevision = "unknown";
  try { gitRevision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(); } catch { /* local metadata only */ }
  await writeFile(resolve(runDirectory, "manifest.json"), JSON.stringify({ startedAt: new Date().toISOString(), gitRevision, suite: suite ?? "all", runtime: { ...runtime, backendUrl: runtime.backendUrl }, scenarioIds: scenarios.map((scenario) => scenario.id), levels: [0, 2] }, null, 2));
  await writeFile(resolve(runDirectory, "transcript.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await writeFile(resolve(runDirectory, "summary.md"), metricSummary(records));
  await writeFile(resolve(runDirectory, "handscore.md"), handscore(records));
  await writeFile(resolve(runDirectory, "handscore.csv"), handscoreCsv(records));
  process.stdout.write(`Wrote ${runDirectory}\n`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
