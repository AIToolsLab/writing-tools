/**
 * Phase 3: Judge simulated conversations against criteria.
 *
 * Loads conversation logs from simulate.ts and evaluates each one against
 * every criterion in criteria.md. Prints a summary table and writes detailed results.
 *
 * Usage:
 *   npx tsx scripts/scenario_design/judge.ts <scenario-id> [archetype-id]
 *
 * Examples:
 *   npx tsx scripts/scenario_design/judge.ts roomDoubleBooking
 *   npx tsx scripts/scenario_design/judge.ts roomDoubleBooking pushy
 *
 * Input: scripts/scenario_design/outputs/<scenario-id>_<archetype>.json
 * Output: scripts/scenario_design/outputs/<scenario-id>_judgments.json
 */

import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'node:url';

const OUTPUTS_DIR = resolve(import.meta.dirname, 'outputs');

export interface Criterion {
  id: string;
  title: string;
  description: string;
}

// Criteria loaded from markdown — parsed into id/description pairs
export function loadCriteria(): Criterion[] {
  const raw = readFileSync(resolve(import.meta.dirname, 'criteria.md'), 'utf-8');
  const criteria: Criterion[] = [];

  // Parse "## N. Title\n\nDescription..." sections
  const sections = raw.split(/^## /m).slice(1);
  for (const section of sections) {
    const lines = section.trim().split('\n');
    const header = lines[0]; // "1. Information Gating"
    const match = header.match(/^\d+\.\s+(.+)$/);
    if (!match) continue;
    const title = match[1];
    const id = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_+$/, '');
    const description = lines.slice(1).join('\n').trim();
    criteria.push({ id, title, description });
  }

  return criteria;
}

const verdictSchema = z.object({
  pass: z.boolean(),
  evidence: z.string().describe('Specific quote or observation from the conversation'),
  concern: z.string().describe('If fail: what went wrong. If pass: empty string.'),
});

export interface Verdict {
  criterionId: string;
  criterionTitle: string;
  pass: boolean;
  evidence: string;
  concern: string;
}

export interface ConversationLog {
  scenarioId: string;
  archetypeId: string;
  archetypeName: string;
  messages: Array<{ role: string; content: string }>;
}

export async function judgeConversation(
  log: ConversationLog,
  criterion: Criterion,
): Promise<Verdict> {
  const transcript = log.messages
    .map((m) => `${m.role === 'user' ? 'Participant' : 'Colleague'}: ${m.content}`)
    .join('\n');

  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: verdictSchema,
    prompt: `You are evaluating an AI colleague's behavior in a simulated workplace chat conversation.

CRITERION: ${criterion.title}
${criterion.description}

CONVERSATION (Participant = study participant, Colleague = AI being evaluated):
${transcript}

Evaluate whether the Colleague satisfied or violated this criterion across the ENTIRE conversation.
Look at all colleague messages, not just the last one.`,
  });

  return {
    criterionId: criterion.id,
    criterionTitle: criterion.title,
    pass: object.pass,
    evidence: object.evidence,
    concern: object.concern,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npx tsx scripts/scenario_design/judge.ts <scenario-id> [archetype-id]');
    process.exit(1);
  }

  const scenarioId = args[0];
  const archetypeFilter = args[1];

  const criteria = loadCriteria();
  console.log(`Loaded ${criteria.length} criteria from criteria.md`);

  // Find conversation logs
  const logFiles = readdirSync(OUTPUTS_DIR)
    .filter((f) => f.startsWith(`${scenarioId}_`) && f.endsWith('.json') && !f.includes('judgment'))
    .filter((f) => !archetypeFilter || f.includes(`_${archetypeFilter}.json`));

  if (logFiles.length === 0) {
    console.error(`No conversation logs found for "${scenarioId}". Run simulate.ts first.`);
    process.exit(1);
  }

  const allResults: Record<string, Verdict[]> = {};

  for (const file of logFiles) {
    const log: ConversationLog = JSON.parse(readFileSync(resolve(OUTPUTS_DIR, file), 'utf-8'));
    console.log(`\nJudging: ${log.archetypeName} (${log.archetypeId})`);

    const verdicts: Verdict[] = [];
    for (const criterion of criteria) {
      const verdict = await judgeConversation(log, criterion);
      const icon = verdict.pass ? '✓' : '✗';
      console.log(`  ${icon} ${verdict.criterionTitle}${verdict.concern ? ': ' + verdict.concern : ''}`);
      verdicts.push(verdict);
    }

    allResults[log.archetypeId] = verdicts;
  }

  // Summary table
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  // Header
  const archetypeIds = Object.keys(allResults);
  const header = ['Criterion', ...archetypeIds.map((id) => id.padEnd(10))].join(' | ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const criterion of criteria) {
    const cells = archetypeIds.map((id) => {
      const verdict = allResults[id].find((v) => v.criterionId === criterion.id);
      return (verdict?.pass ? '  PASS  ' : '  FAIL  ').padEnd(10);
    });
    console.log([criterion.title.padEnd(30).slice(0, 30), ...cells].join(' | '));
  }

  // Count failures
  const totalFailures = Object.values(allResults)
    .flat()
    .filter((v) => !v.pass).length;

  console.log(`\nTotal failures: ${totalFailures}`);

  // Write detailed results
  const outPath = resolve(OUTPUTS_DIR, `${scenarioId}_judgments.json`);
  writeFileSync(outPath, JSON.stringify(allResults, null, 2) + '\n');
  console.log(`Detailed results: ${outPath}`);

  if (totalFailures > 0) {
    console.log(
      `\nTo fix: point a coding agent at ${outPath} (each failure has evidence + concern) ` +
        'and have it revise the scenario systemPromptLines. Instruct it to come up with testable hypotheses about what went wrong and how to fix it.',
    );
  }

  process.exit(totalFailures > 0 ? 1 : 0);
}

// Only run when executed directly, not when imported (e.g. by probe.ts).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
