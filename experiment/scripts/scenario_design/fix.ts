/**
 * Phase 4: Analyze judgment failures and propose systemPrompt fixes.
 *
 * Reads the judgment results and the scenario, then asks the LLM to diagnose
 * why criteria failed and propose minimal edits to the systemPrompt.
 *
 * Usage:
 *   npx tsx scripts/scenario_design/fix.ts <scenario-id>
 *
 * Input: scripts/scenario_design/outputs/<scenario-id>_judgments.json
 *        + the scenario JSON (from outputs/ or scenarios.json)
 * Output: proposed changes printed to stdout
 */

import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import scenariosData from '../../lib/scenarios.json';

const OUTPUTS_DIR = resolve(import.meta.dirname, 'outputs');

function loadScenario(scenarioId: string): Record<string, unknown> {
  const generatedPath = resolve(OUTPUTS_DIR, `${scenarioId}.json`);
  if (existsSync(generatedPath)) {
    return JSON.parse(readFileSync(generatedPath, 'utf-8'));
  }
  const builtin = scenariosData[scenarioId as keyof typeof scenariosData];
  if (builtin) return builtin as unknown as Record<string, unknown>;
  throw new Error(`Scenario "${scenarioId}" not found`);
}

function getSystemPromptLines(scenario: Record<string, unknown>): string[] {
  const chat = scenario.chat as Record<string, unknown>;
  if (Array.isArray(chat.systemPromptLines)) return chat.systemPromptLines as string[];
  if (typeof chat.systemPrompt === 'string') return (chat.systemPrompt as string).split('\n');
  throw new Error('No systemPrompt found in scenario');
}

interface Verdict {
  criterionId: string;
  criterionTitle: string;
  pass: boolean;
  evidence: string;
  concern: string;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npx tsx scripts/scenario_design/fix.ts <scenario-id>');
    process.exit(1);
  }

  const scenarioId = args[0];

  // Load judgments
  const judgmentsPath = resolve(OUTPUTS_DIR, `${scenarioId}_judgments.json`);
  if (!existsSync(judgmentsPath)) {
    console.error(`No judgments found. Run judge.ts first.`);
    process.exit(1);
  }
  const judgments: Record<string, Verdict[]> = JSON.parse(readFileSync(judgmentsPath, 'utf-8'));

  // Collect failures
  const failures: Array<{ archetype: string; criterion: string; evidence: string; concern: string }> = [];
  for (const [archetypeId, verdicts] of Object.entries(judgments)) {
    for (const v of verdicts) {
      if (!v.pass) {
        failures.push({
          archetype: archetypeId,
          criterion: v.criterionTitle,
          evidence: v.evidence,
          concern: v.concern,
        });
      }
    }
  }

  if (failures.length === 0) {
    console.log('No failures found — nothing to fix!');
    process.exit(0);
  }

  console.log(`Found ${failures.length} failure(s). Analyzing...\n`);

  // Load the current systemPrompt
  const scenario = loadScenario(scenarioId);
  const promptLines = getSystemPromptLines(scenario);
  const currentPrompt = promptLines.map((line, i) => `${String(i + 1).padStart(3)}: ${line}`).join('\n');

  // Load conversation logs for failed archetypes
  const failedArchetypes = [...new Set(failures.map((f) => f.archetype))];
  const conversationExcerpts: string[] = [];
  for (const archetypeId of failedArchetypes) {
    const logPath = resolve(OUTPUTS_DIR, `${scenarioId}_${archetypeId}.json`);
    if (existsSync(logPath)) {
      const log = JSON.parse(readFileSync(logPath, 'utf-8'));
      const transcript = log.messages
        .map((m: { role: string; content: string }) =>
          `${m.role === 'user' ? 'Participant' : 'Colleague'}: ${m.content}`)
        .join('\n');
      conversationExcerpts.push(`--- ${archetypeId} ---\n${transcript}`);
    }
  }

  const result = await generateText({
    model: openai('gpt-4o'),
    prompt: `You are helping improve an AI colleague's system prompt for a research study.

CURRENT SYSTEM PROMPT (line numbers for reference):
${currentPrompt}

FAILURES:
${failures.map((f) => `- [${f.archetype}] ${f.criterion}: ${f.concern} (evidence: "${f.evidence}")`).join('\n')}

RELEVANT CONVERSATIONS:
${conversationExcerpts.join('\n\n')}

Analyze why these failures happened and propose MINIMAL edits to the system prompt.
For each proposed change:
1. Identify the root cause
2. Specify which line(s) to change
3. Show the exact before/after text
4. Explain why this fix addresses the failure without breaking other criteria

Be conservative — prefer adding a clarifying phrase over rewriting sections.
Do NOT add new sections or restructure the prompt.`,
    maxOutputTokens: 2000,
  });

  console.log(result.text);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
