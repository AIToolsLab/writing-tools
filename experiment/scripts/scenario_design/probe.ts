/**
 * Phase: Single-turn probes.
 *
 * Fast, deterministic adversarial checks. Each probe seeds the conversation with the
 * scenario's opening messages, sends ONE participant message, and judges the colleague's
 * reply against only the criteria that probe targets (slugs from criteria.md). Also checks
 * that the reply came back within the production latency budget (API_TIMEOUT_MS).
 *
 * Replaces the old scripts/evalColleague.ts single-turn eval, now built on the same
 * scenario config, criteria.md, and judge as the rest of the pipeline.
 *
 * Usage:
 *   npx tsx scripts/scenario_design/probe.ts <scenario-id> [probe-name]
 *
 * Examples:
 *   npx tsx scripts/scenario_design/probe.ts roomDoubleBooking
 *   npx tsx scripts/scenario_design/probe.ts roomDoubleBooking "Thanks"
 *
 * Output: scripts/scenario_design/outputs/<scenario-id>_probes.json
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { API_TIMEOUT_MS } from '../../lib/studyConfig';
import {
  loadScenario,
  getSystemPrompt,
  getColleagueModelConfig,
  callColleague,
  type Message,
} from './simulate';
import { loadCriteria, judgeConversation, type ConversationLog, type Verdict } from './judge';

const OUTPUTS_DIR = resolve(import.meta.dirname, 'outputs');

interface Probe {
  name: string;
  input: string;
  criteria: string[]; // criteria.md slugs (see loadCriteria)
}

// Scenario-agnostic probes — these hold for any email-writing scenario.
const GENERIC_PROBES: Probe[] = [
  { name: 'Passive acknowledgment', input: 'Ok, got it', criteria: ['information_gating'] },
  { name: 'Simple acknowledgment', input: 'Thanks', criteria: ['information_gating'] },
  {
    name: 'Request to write email',
    input: 'Can you write the email for me?',
    criteria: ['refusal_to_draft'],
  },
  {
    name: 'Request for wording',
    input: 'What should I say?',
    criteria: ['refusal_to_draft', 'tone_and_character'],
  },
  { name: 'Vague follow-up', input: 'Anything else I should know?', criteria: ['information_gating'] },
];

interface ProbeResult {
  name: string;
  input: string;
  response: string;
  latencyMs: number;
  reasoningTokens?: number;
  latencyPass: boolean;
  verdicts: Verdict[];
  pass: boolean;
}

function getScenarioProbes(scenario: Record<string, unknown>): Probe[] {
  const chat = (scenario.chat ?? {}) as Record<string, unknown>;
  const raw = Array.isArray(chat.probes) ? (chat.probes as Array<Record<string, unknown>>) : [];
  return raw.map((p) => ({
    name: typeof p.name === 'string' ? p.name : String(p.input),
    input: String(p.input),
    criteria: Array.isArray(p.criteria) ? (p.criteria as string[]) : [],
  }));
}

async function runProbe(
  scenarioId: string,
  scenario: Record<string, unknown>,
  probe: Probe,
  criteriaById: Map<string, ReturnType<typeof loadCriteria>[number]>,
): Promise<ProbeResult> {
  const systemPrompt = getSystemPrompt(scenario);
  const modelConfig = getColleagueModelConfig(scenario);
  const chat = scenario.chat as Record<string, unknown>;

  // Seed with the colleague's opening messages, then the single probe message.
  const messages: Message[] = (chat.initialMessages as string[]).map((content) => ({
    role: 'assistant' as const,
    content,
  }));
  messages.push({ role: 'user', content: probe.input });

  const colleague = await callColleague(systemPrompt, messages, modelConfig);
  const response = colleague.messages.join(' | ');
  messages.push({ role: 'assistant', content: response });

  const log: ConversationLog = {
    scenarioId,
    archetypeId: 'probe',
    archetypeName: `Probe: ${probe.name}`,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  const verdicts: Verdict[] = [];
  for (const slug of probe.criteria) {
    const criterion = criteriaById.get(slug);
    if (!criterion) {
      console.warn(`  ! Unknown criterion slug "${slug}" (not in criteria.md) — skipping`);
      continue;
    }
    verdicts.push(await judgeConversation(log, criterion));
  }

  const latencyPass = colleague.latencyMs <= API_TIMEOUT_MS;
  const pass = latencyPass && verdicts.every((v) => v.pass);

  return {
    name: probe.name,
    input: probe.input,
    response,
    latencyMs: colleague.latencyMs,
    reasoningTokens: colleague.reasoningTokens,
    latencyPass,
    verdicts,
    pass,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npx tsx scripts/scenario_design/probe.ts <scenario-id> [probe-name]');
    process.exit(1);
  }

  const scenarioId = args[0];
  const probeFilter = args[1];
  const scenario = loadScenario(scenarioId);

  const criteria = loadCriteria();
  const criteriaById = new Map(criteria.map((c) => [c.id, c]));

  let probes = [...GENERIC_PROBES, ...getScenarioProbes(scenario)];
  if (probeFilter) {
    probes = probes.filter((p) => p.name === probeFilter || p.input === probeFilter);
    if (probes.length === 0) {
      console.error(`No probe matching "${probeFilter}"`);
      process.exit(1);
    }
  }

  const modelConfig = getColleagueModelConfig(scenario);
  console.log(
    `Probing "${scenarioId}" with ${probes.length} probe(s) ` +
      `(model ${modelConfig.model}, reasoning ${modelConfig.reasoningEffort}, budget ${API_TIMEOUT_MS}ms)\n`,
  );

  mkdirSync(OUTPUTS_DIR, { recursive: true });

  const results: ProbeResult[] = [];
  for (const probe of probes) {
    const result = await runProbe(scenarioId, scenario, probe, criteriaById);
    results.push(result);

    const latencyIcon = result.latencyPass ? '' : ' ⚠️ OVER BUDGET';
    console.log(`${result.pass ? '✓' : '✗'} ${result.name} (${result.latencyMs}ms${latencyIcon})`);
    console.log(`    input: "${result.input}"`);
    console.log(`    reply: "${result.response}"`);
    for (const v of result.verdicts) {
      console.log(`    ${v.pass ? '✓' : '✗'} ${v.criterionTitle}${v.concern ? ': ' + v.concern : ''}`);
    }
    console.log('');
  }

  // Summary
  const passed = results.filter((r) => r.pass).length;
  console.log('='.repeat(60));
  console.log(`${passed}/${results.length} probes passed`);
  const latencyFails = results.filter((r) => !r.latencyPass);
  if (latencyFails.length > 0) {
    console.log(`${latencyFails.length} probe(s) exceeded the ${API_TIMEOUT_MS}ms latency budget.`);
  }

  const outPath = resolve(OUTPUTS_DIR, `${scenarioId}_probes.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2) + '\n');
  console.log(`Detailed results: ${outPath}`);

  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
