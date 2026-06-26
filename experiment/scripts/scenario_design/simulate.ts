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
  latencyMs?: number;       // wall-clock time for this colleague turn
  reasoningTokens?: number; // reasoning tokens reported by the provider
}

export interface ColleagueModelConfig {
  model: string;
  reasoningEffort: string;
}

export interface ColleagueResult {
  messages: string[];
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
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    maxOutputTokens: 300,
    providerOptions: {
      openai: { reasoningEffort: modelConfig.reasoningEffort },
    },
  });
  const latencyMs = Date.now() - start;
  const reasoningTokens = result.providerMetadata?.openai?.reasoningTokens as number | undefined;

  const raw = result.text.trim();
  let messages: string[] = [raw];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) messages = parsed;
  } catch { /* fall through */ }

  return { messages, latencyMs, reasoningTokens };
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
    model: openai('gpt-4o'),
    system,
    messages: history.map((m) => ({
      // Flip roles: the participant sees colleague messages as "assistant" and their own as "user",
      // but from the participant-LLM's perspective, the colleague messages are incoming (user) and
      // the participant's own are outgoing (assistant).
      role: m.role === 'assistant' ? 'user' as const : 'assistant' as const,
      content: m.content,
    })),
    maxOutputTokens: 150,
  });

  return result.text.trim();
}

async function simulateConversation(
  scenarioId: string,
  scenario: Record<string, unknown>,
  archetype: typeof ARCHETYPES[number],
): Promise<ConversationLog> {
  const systemPrompt = getSystemPrompt(scenario);
  const modelConfig = getColleagueModelConfig(scenario);
  const chat = scenario.chat as Record<string, unknown>;
  const taskInstructions = scenario.taskInstructions as Record<string, string>;

  // Seed with initial messages from the colleague
  const messages: Message[] = [];
  for (const msg of chat.initialMessages as string[]) {
    messages.push({ role: 'assistant', content: msg });
  }

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

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npx tsx scripts/scenario_design/simulate.ts <scenario-id> [archetype-id]');
    process.exit(1);
  }

  const scenarioId = args[0];
  const archetypeFilter = args[1];
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

  console.log(`Simulating ${archetypes.length} archetype(s) for "${scenarioId}"...`);

  for (const archetype of archetypes) {
    const log = await simulateConversation(scenarioId, scenario, archetype);
    const outPath = resolve(OUTPUTS_DIR, `${scenarioId}_${archetype.id}.json`);
    writeFileSync(outPath, JSON.stringify(log, null, 2) + '\n');
    console.log(`  Wrote ${outPath}`);
  }

  console.log('\nDone. Run judge.ts to evaluate the conversations.');
}

// Only run when executed directly, not when imported (e.g. by probe.ts).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
