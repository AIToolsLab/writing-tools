/**
 * Phase 2: Simulate multi-turn conversations between participant archetypes and the colleague.
 *
 * Loads a generated scenario JSON (or an existing one from scenarios.json) and runs
 * each participant archetype through a ~8-turn conversation with the colleague AI.
 *
 * Usage:
 *   npx tsx scripts/scenario_design/simulate.ts <scenario-id> [archetype-id]
 *
 * Examples:
 *   npx tsx scripts/scenario_design/simulate.ts roomDoubleBooking          # All archetypes
 *   npx tsx scripts/scenario_design/simulate.ts roomDoubleBooking eager    # Just one
 *
 * Input: scripts/scenario_design/outputs/<scenario-id>.json OR lib/scenarios.json
 * Output: scripts/scenario_design/outputs/<scenario-id>_<archetype>.json
 */

import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES } from './archetypes';
import scenariosData from '../../lib/scenarios.json';
import { API_TIMEOUT_MS } from '../../lib/studyConfig';

const OUTPUTS_DIR = resolve(import.meta.dirname, 'outputs');
const MAX_TURNS = 8;

// Defaults if a (possibly generated) scenario omits the colleague model config.
const DEFAULT_MODEL = 'gpt-5.5';
const DEFAULT_REASONING_EFFORT = 'low';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  raw?: string;             // colleague's verbatim model output (the JSON array string)
  latencyMs?: number;       // wall-clock time for this colleague turn
  reasoningTokens?: number; // reasoning tokens reported by the provider
}

export interface ColleagueModelConfig {
  model: string;
  reasoningEffort: string;
}

export interface ColleagueResult {
  messages: string[];
  raw: string; // verbatim model output before JSON parsing/joining
  latencyMs: number;
  reasoningTokens?: number;
}

interface ConversationLog {
  scenarioId: string;
  archetypeId: string;
  archetypeName: string;
  messages: Message[];
}

export function loadScenario(scenarioId: string) {
  // Try outputs/ first (generated scenario), then fall back to scenarios.json
  const generatedPath = resolve(OUTPUTS_DIR, `${scenarioId}.json`);
  if (existsSync(generatedPath)) {
    console.log(`Loading generated scenario from ${generatedPath}`);
    return JSON.parse(readFileSync(generatedPath, 'utf-8'));
  }

  const builtin = scenariosData[scenarioId as keyof typeof scenariosData];
  if (builtin) {
    console.log(`Loading built-in scenario "${scenarioId}" from scenarios.json`);
    return builtin;
  }

  throw new Error(`Scenario "${scenarioId}" not found in outputs/ or scenarios.json`);
}

export function getSystemPrompt(scenario: Record<string, unknown>): string {
  const chat = scenario.chat as Record<string, unknown>;
  if (Array.isArray(chat.systemPromptLines)) {
    return (chat.systemPromptLines as string[]).join('\n');
  }
  if (typeof chat.systemPrompt === 'string') {
    return chat.systemPrompt;
  }
  throw new Error('Scenario has neither systemPromptLines nor systemPrompt');
}

// Read the colleague model + reasoning effort from the scenario, falling back to
// defaults for older/generated scenarios that predate these fields.
export function getColleagueModelConfig(scenario: Record<string, unknown>): ColleagueModelConfig {
  const chat = (scenario.chat ?? {}) as Record<string, unknown>;
  return {
    model: typeof chat.model === 'string' ? chat.model : DEFAULT_MODEL,
    reasoningEffort:
      typeof chat.reasoningEffort === 'string' ? chat.reasoningEffort : DEFAULT_REASONING_EFFORT,
  };
}

export async function callColleague(
  systemPrompt: string,
  history: Message[],
  modelConfig: ColleagueModelConfig,
): Promise<ColleagueResult> {
  const start = Date.now();
  const result = await generateText({
    model: openai(modelConfig.model),
    system: systemPrompt,
    // Send the colleague its OWN prior turns verbatim (the raw JSON array it emitted), exactly as
    // the live app does: ChatPanel keeps each assistant UIMessage's raw text and posts the whole
    // array back through convertToModelMessages. Passing the harness's joined-plaintext rendering
    // instead put non-JSON assistant turns in the model's own context, which taught it to answer
    // in plain text — manufacturing Response Format failures the live app never sees.
    messages: history.map((m) => ({
      role: m.role,
      content: m.role === 'assistant' ? (m.raw ?? m.content) : m.content,
    })),
    maxOutputTokens: 300,
    providerOptions: {
      openai: { reasoningEffort: modelConfig.reasoningEffort },
    },
  });
  const latencyMs = Date.now() - start;
  const reasoningTokens =
    (result.providerMetadata?.openai?.reasoningTokens as number | undefined) ??
    result.usage?.reasoningTokens;

  const raw = result.text.trim();
  let messages: string[] = [raw];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) messages = parsed;
  } catch { /* fall through */ }

  return { messages, raw, latencyMs, reasoningTokens };
}

async function callParticipant(
  archetypePrompt: string,
  taskContext: string,
  history: Message[],
): Promise<string> {
  const system = `${archetypePrompt}

TASK CONTEXT:
${taskContext}

You are chatting with your colleague to gather information before writing an email.
Respond with a single short chat message (plain text, not JSON). Keep it natural.`;

  const result = await generateText({
    model: openai('gpt-5.6-terra'),
    system,
    providerOptions: {
      openai: { reasoningEffort: 'low' }
    },
    messages: history.map((m) => ({
      // Flip roles: the participant sees colleague messages as "assistant" and their own as "user",
      // but from the participant-LLM's perspective, the colleague messages are incoming (user) and
      // the participant's own are outgoing (assistant).
      role: m.role === 'assistant' ? 'user' as const : 'assistant' as const,
      content: m.content,
    })),
    // The participant simulator is a reasoning model, and reasoning tokens bill against this same
    // budget — at 150 the allowance can be consumed before a single visible token is emitted,
    // yielding an empty participant turn. 1500 leaves headroom; replies stay short because the
    // archetype prompt asks for a single short chat message, not because the budget truncates them.
    maxOutputTokens: 1500,
  });

  return result.text.trim();
}

async function simulateConversation(
  scenarioId: string,
  scenario: Record<string, unknown>,
  archetype: typeof ARCHETYPES[number],
  modelOverride?: string,
  reasoningEffortOverride?: string,
): Promise<ConversationLog> {
  const systemPrompt = getSystemPrompt(scenario);
  const modelConfig = {
    ...getColleagueModelConfig(scenario),
    ...(modelOverride ? { model: modelOverride } : {}),
    ...(reasoningEffortOverride ? { reasoningEffort: reasoningEffortOverride } : {}),
  };
  const chat = scenario.chat as Record<string, unknown>;
  const taskInstructions = scenario.taskInstructions as Record<string, string>;

  // Seed with the colleague's opening messages. The live app sets these as a SINGLE assistant
  // message whose text is JSON.stringify(initialMessages) (ChatPanel.tsx) — not one message per
  // line — so mirror that here. Splitting them produced a history of N plain-text assistant turns,
  // which is both the wrong shape and the wrong format versus production.
  const seeds = chat.initialMessages as string[];
  const messages: Message[] = [
    { role: 'assistant', content: seeds.join(' | '), raw: JSON.stringify(seeds) },
  ];

  console.log(`\n--- ${archetype.name} ---`);
  for (const msg of messages) {
    console.log(`  Colleague: ${msg.content}`);
  }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    // Participant responds
    const participantMsg = await callParticipant(
      archetype.systemPrompt,
      taskInstructions.description,
      messages,
    );
    messages.push({ role: 'user', content: participantMsg });
    console.log(`  Participant: ${participantMsg}`);

    // Colleague responds
    const colleague = await callColleague(systemPrompt, messages, modelConfig);
    const joined = colleague.messages.join(' | ');
    messages.push({
      role: 'assistant',
      content: joined,
      raw: colleague.raw,
      latencyMs: colleague.latencyMs,
      reasoningTokens: colleague.reasoningTokens,
    });
    const slow = colleague.latencyMs > API_TIMEOUT_MS ? ' ⚠️ over budget' : '';
    console.log(`  Colleague (${colleague.latencyMs}ms${slow}): ${joined}`);
  }

  return {
    scenarioId,
    archetypeId: archetype.id,
    archetypeName: archetype.name,
    messages,
  };
}

// Parse positional args plus optional `--label <name>`, `--model <id>`, and `--reasoning-effort
// <level>`. The label namespaces a run's output files (see main), so its characters are restricted
// to what's safe in a filename prefix — no `_` (would collide with the archetype separator) and no
// path characters. `--model`/`--reasoning-effort` override the colleague config from the scenario
// for this invocation only (does not touch scenarios.json), for A/B testing colleague models/effort
// without risking the live study config.
function parseArgs(argv: string[]): { args: string[]; label?: string; model?: string; reasoningEffort?: string } {
  const positional: string[] = [];
  let label: string | undefined;
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--label') {
      label = argv[++i];
      if (!label || !/^[A-Za-z0-9-]+$/.test(label)) {
        console.error('--label must be a non-empty name using only letters, digits, and hyphens.');
        process.exit(1);
      }
    } else if (argv[i] === '--model') {
      model = argv[++i];
      if (!model) {
        console.error('--model requires a value.');
        process.exit(1);
      }
    } else if (argv[i] === '--reasoning-effort') {
      reasoningEffort = argv[++i];
      if (!reasoningEffort) {
        console.error('--reasoning-effort requires a value (e.g. low, medium, high, xhigh).');
        process.exit(1);
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { args: positional, label, model, reasoningEffort };
}

async function main() {
  const { args, label, model, reasoningEffort } = parseArgs(process.argv.slice(2));
  if (args.length < 1) {
    console.error(
      'Usage: npx tsx scripts/scenario_design/simulate.ts <scenario-id> [archetype-id] ' +
        '[--label <name>] [--model <id>] [--reasoning-effort <level>]',
    );
    process.exit(1);
  }

  const scenarioId = args[0];
  const archetypeFilter = args[1];
  // `--label test` writes to outputs/<scenario>.<label>_<archetype>.json instead of clobbering the
  // real logs. judge.ts reads the same namespace via its own --label. A normal (unlabeled) run
  // ignores labeled files, and vice-versa, because the prefixes differ (`.` vs `_` after the id).
  const ns = label ? `${scenarioId}.${label}` : scenarioId;
  const scenario = loadScenario(scenarioId);

  const archetypes = archetypeFilter
    ? ARCHETYPES.filter((a) => a.id === archetypeFilter)
    : ARCHETYPES;

  if (archetypes.length === 0) {
    console.error(`Unknown archetype: ${archetypeFilter}`);
    console.error(`Available: ${ARCHETYPES.map((a) => a.id).join(', ')}`);
    process.exit(1);
  }

  mkdirSync(OUTPUTS_DIR, { recursive: true });

  const overrideNote = [
    model ? `model: ${model}` : null,
    reasoningEffort ? `reasoning: ${reasoningEffort}` : null,
  ].filter(Boolean).join(', ');
  console.log(
    `Simulating ${archetypes.length} archetype(s) for "${scenarioId}"${overrideNote ? ` (override — ${overrideNote})` : ''}...`,
  );

  for (const archetype of archetypes) {
    const log = await simulateConversation(scenarioId, scenario, archetype, model, reasoningEffort);
    const outPath = resolve(OUTPUTS_DIR, `${ns}_${archetype.id}.json`);
    writeFileSync(outPath, JSON.stringify(log, null, 2) + '\n');
    console.log(`  Wrote ${outPath}`);
  }

  const judgeCmd = `npx tsx scripts/scenario_design/judge.ts ${scenarioId}${label ? ` --label ${label}` : ''}`;
  console.log(`\nDone. Evaluate the conversations with:\n  ${judgeCmd}`);
}

// Only run when executed directly, not when imported (e.g. by probe.ts).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
