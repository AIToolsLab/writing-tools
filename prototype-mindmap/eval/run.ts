import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { contractForLevel, type AssistanceLevel } from "../src/assistance-contract";
import { historyForCurrentTurn, makeLLM, type ConversationMessage } from "../src/api";
import type { AssistantResponse } from "../src/assistant-response";
import { defaultConfig } from "../src/config";
import { ThoughtUnitStore } from "../src/map-store";
import { containsWholePhrase, contentTokens, stem, stemSet } from "../src/normalize";
import { createConversationState, processTurn } from "../src/stage1-loop";
import { EVAL_SCENARIOS, type EvalMemoryEvent, type EvalScenario } from "./scenarios";

interface EvalRecord {
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
  smuggleNote: string;
  expectedBehavior?: string;
  recallNote?: string;
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
  runtime: { backendUrl: string; model?: string; reasoningEffort?: string },
): Promise<EvalRecord[]> {
  const state = createConversationState();
  state.draft = scenario.draft ?? "";
  const store = new ThoughtUnitStore();
  const history = seedPrelude(scenario, state);
  const records: EvalRecord[] = [];

  for (const [index, userText] of scenario.userTurns.entries()) {
    const knownBeforeResponse = state.bank.getAll().map((utterance) => utterance.text);
    const model = makeLLM(
      defaultConfig,
      historyForCurrentTurn(history, userText),
      undefined,
      "chat_json",
      runtime,
    );
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
        ...(scenario.selectedPassage ? { selectedFocus: { draftText: scenario.selectedPassage } } : {}),
      },
    );
    const initialResponse = result.diagnostics.find((event) => event.stage === "response" && event.outcome === "accepted");
    records.push({
      scenarioId: scenario.id,
      scenarioTitle: scenario.title,
      level,
      turn: index + 1,
      userText,
      assistantText: result.response?.text,
      responseKind: result.response?.kind,
      proposalOrigin: result.proposal?.origin,
      influenceOverlapRatio: result.proposal?.influenceTrace?.overlapRatio,
      terminal: result.terminal?.kind,
      repairCount: result.diagnostics.filter((event) => event.code === "repair_requested").length,
      initialResponseKind: initialResponse?.code,
      newContentWordRatio: responseRatio(result.response, [...knownBeforeResponse, userText]),
      diagnostics: result.diagnostics.map((event) => ({ stage: event.stage, outcome: event.outcome, code: event.code })),
      smuggleNote: scenario.smuggleNote,
      expectedBehavior: scenario.expectedBehavior,
      recallNote: scenario.recallNote,
    });
    history.push({ role: "user", content: userText });
    if (result.response) history.push({ role: "assistant", content: result.response.text });
    for (const event of scenario.memoryEvents?.filter((item) => item.afterUserTurn === index + 1) ?? []) applyMemoryEvent(event, state);
  }
  return records;
}

function metricSummary(records: EvalRecord[]): string {
  const repairTurns = records.filter((record) => record.repairCount > 0).length;
  const reflectionAttempts = records.filter((record) => record.initialResponseKind === "reflection");
  const firstPassMirrors = reflectionAttempts.filter((record) => record.responseKind === "reflection" && record.repairCount === 0).length;
  const rate = (value: number, denominator: number) => denominator ? `${value}/${denominator} (${((value / denominator) * 100).toFixed(1)}%)` : "n/a";
  return [
    "# Mindmap evaluation run",
    "",
    "These metrics are descriptive canaries, not pass/fail gates. Hand-score the transcript before drawing conclusions.",
    "",
    "| Metric | Value |",
    "| --- | --- |",
    `| Assistant turns | ${records.length} |`,
    `| Turns using the single repair | ${rate(repairTurns, records.length)} |`,
    `| First-pass grounded mirrors | ${rate(firstPassMirrors, reflectionAttempts.length)} |`,
    `| Terminal repair failures | ${records.filter((record) => record.terminal).length} |`,
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
  return [
    "# Hand-scoring sheet",
    "",
    "Score the displayed assistant response, not the canary. `newContentWordRatio` is advisory: ordinary questions can appropriately contain words absent from the Source Bank.",
    "",
    "| Scenario | Level | Turn | Kind | Origin | Repair | Canary | Introduced absent concept? | Asserted unstated relationship? | Offered unraised direction? | AI material attributed? | Notes |",
    "| --- | ---: | ---: | --- | --- | ---: | ---: | --- | --- | --- | --- | --- |",
    ...records.map((record) => `| ${record.scenarioId} | L${record.level} | ${record.turn} | ${record.responseKind ?? record.terminal ?? "none"} | ${record.proposalOrigin ?? ""} | ${record.repairCount} | ${record.newContentWordRatio?.toFixed(2) ?? ""} |  |  |  |  |  |`),
    "",
    "## Scenario guidance",
    "",
    ...Array.from(new Map(records.map((record) => [record.scenarioId, record])).values()).map((record) => `- **${record.scenarioId}:** ${record.smuggleNote}${record.expectedBehavior ? ` ${record.expectedBehavior}` : ""}${record.recallNote ? ` Recall: ${record.recallNote}` : ""}`),
  ].join("\n");
}

async function main(): Promise<void> {
  const scenarioId = argument("--scenario");
  const scenarios = scenarioId ? EVAL_SCENARIOS.filter((scenario) => scenario.id === scenarioId) : EVAL_SCENARIOS;
  if (!scenarios.length) throw new Error(`No scenario named ${scenarioId}`);
  const runtime = {
    backendUrl: process.env.MINDMAP_EVAL_BACKEND_URL ?? "http://localhost:8000/api",
    model: process.env.MINDMAP_EVAL_MODEL,
    reasoningEffort: process.env.MINDMAP_EVAL_REASONING_EFFORT ?? "low",
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
  await writeFile(resolve(runDirectory, "manifest.json"), JSON.stringify({ startedAt: new Date().toISOString(), runtime: { ...runtime, backendUrl: runtime.backendUrl }, scenarioIds: scenarios.map((scenario) => scenario.id), levels: [0, 2] }, null, 2));
  await writeFile(resolve(runDirectory, "transcript.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await writeFile(resolve(runDirectory, "summary.md"), metricSummary(records));
  await writeFile(resolve(runDirectory, "handscore.md"), handscore(records));
  process.stdout.write(`Wrote ${runDirectory}\n`);
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
