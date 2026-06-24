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
import { ARCHETYPES } from './archetypes';
import scenariosData from '../../lib/scenarios.json';

const OUTPUTS_DIR = resolve(import.meta.dirname, 'outputs');
const MAX_TURNS = 8;

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface ConversationLog {
  scenarioId: string;
  archetypeId: string;
  archetypeName: string;
  messages: Message[];
}

function loadScenario(scenarioId: string) {
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

function getSystemPrompt(scenario: Record<string, unknown>): string {
  const chat = scenario.chat as Record<string, unknown>;
  if (Array.isArray(chat.systemPromptLines)) {
    return (chat.systemPromptLines as string[]).join('\n');
  }
  if (typeof chat.systemPrompt === 'string') {
    return chat.systemPrompt;
  }
  throw new Error('Scenario has neither systemPromptLines nor systemPrompt');
}

async function callColleague(
  systemPrompt: string,
  history: Message[],
): Promise<string[]> {
  const result = await generateText({
    model: openai('gpt-5.2'),
    system: systemPrompt,
    messages: history.map((m) => ({ role: m.role, content: m.content })),
    maxOutputTokens: 300,
  });

  const raw = result.text.trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  return [raw];
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
    const colleagueMessages = await callColleague(systemPrompt, messages);
    const joined = colleagueMessages.join(' | ');
    messages.push({ role: 'assistant', content: joined });
    console.log(`  Colleague: ${joined}`);
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
