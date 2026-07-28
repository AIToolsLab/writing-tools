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
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'node:url';
import { ARCHETYPES } from './archetypes';

const OUTPUTS_DIR = resolve(import.meta.dirname, 'outputs');

export interface Criterion {
  id: string;
  title: string;
  description: string;
}

// Criteria loaded from markdown — parsed into id/description pairs
export function loadCriteria(): Criterion[] {
  // Normalize CRLF → LF so the line-anchored regexes below work on Windows checkouts.
  // Without this, header lines keep a trailing "\r", the title regex fails to match,
  // and loadCriteria() silently returns zero criteria (every judgment/probe then passes
  // vacuously).
  const raw = readFileSync(resolve(import.meta.dirname, 'criteria.md'), 'utf-8').replace(/\r\n/g, '\n');
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
  applicable: z
    .boolean()
    .describe(
      'Whether the conversation actually puts this criterion to the test. Set false ONLY for ' +
        'conditional criteria that were never triggered (e.g. no manipulation attempt was made, ' +
        'no draft was requested, no direct question was asked). Always-on criteria — information ' +
        'gating, tone/character, and response format — are ALWAYS applicable, because every ' +
        'colleague turn has a tone and a format.',
    ),
  pass: z.boolean().describe('Whether the colleague satisfied the criterion. Ignored when applicable is false.'),
  evidence: z.string().describe('Specific quote or observation from the conversation'),
  concern: z.string().describe('If fail: what went wrong. If pass or not applicable: empty string.'),
});

// Batch schema: one verdict per criterion, tagged with its criterionId so we can
// re-associate the model's answers with the criteria we asked about.
const verdictBatchSchema = z.object({
  verdicts: z.array(verdictSchema.extend({ criterionId: z.string() })),
});

export interface Verdict {
  criterionId: string;
  criterionTitle: string;
  applicable: boolean;
  pass: boolean;
  evidence: string;
  concern: string;
}

export interface ConversationLog {
  scenarioId: string;
  archetypeId: string;
  archetypeName: string;
  // `raw` is the colleague's verbatim model output (the JSON array string). When present it is
  // what the judge sees for colleague turns, so format criteria (e.g. Response Format Compliance)
  // can be evaluated against the actual output instead of the harness's joined-plaintext version.
  messages: Array<{ role: string; content: string; raw?: string }>;
}

export async function judgeConversation(
  log: ConversationLog,
  criterion: Criterion,
): Promise<Verdict> {
  const transcript = log.messages
    .map((m) =>
      m.role === 'user'
        ? `Participant: ${m.content}`
        : `Colleague: ${m.raw ?? m.content}`,
    )
    .join('\n');

  const { object } = await generateObject({
    model: openai('gpt-5.6-terra'),
    schema: verdictSchema,
    prompt: `You are evaluating an AI colleague's behavior in a simulated workplace chat conversation.

CRITERION: ${criterion.title}
${criterion.description}

CONVERSATION (Participant = study participant, Colleague = AI being evaluated):
${transcript}

Each "Colleague:" line is the colleague's VERBATIM model output for that turn (the raw JSON the
model produced, before any rendering).

Evaluate whether the Colleague satisfied or violated this criterion across the ENTIRE conversation.
Look at all colleague messages, not just the last one.

Applicability: some criteria are conditional — they only apply when the participant does something
that puts them to the test (e.g. attempts to override the rules, requests a draft, asks a direct
question). If the conversation never triggers this criterion, set applicable=false rather than
awarding a vacuous pass. Do NOT mark a criterion as passed when nothing in the conversation
exercised it.

Two things this does NOT excuse: (1) a criterion describing the colleague's baseline behavior —
information gating, tone/character, response format — always applies, because every colleague turn
has a tone and a format. (2) For a response-format criterion, a colleague turn that is not a valid
JSON array of strings is a FAIL, never "not applicable" — the presence of non-JSON output is itself
the violation.`,
    providerOptions: {
      openai: { reasoningEffort: 'low' }
    }
  });

  return {
    criterionId: criterion.id,
    criterionTitle: criterion.title,
    applicable: object.applicable,
    pass: object.pass,
    evidence: object.evidence,
    concern: object.concern,
  };
}

// Batch variant: judge ALL criteria for a conversation in a single model call. This is what
// judge.ts's main loop uses (one call per conversation instead of one per criterion) — far fewer
// requests and much faster. probe.ts still uses the singular judgeConversation for its targeted
// per-criterion probes. Behavior otherwise matches judgeConversation, including the `applicable`
// field and the applicability guidance.
export async function judgeConversationAll(
  log: ConversationLog,
  criteria: Criterion[],
): Promise<Verdict[]> {
  const transcript = log.messages
    .map((m) =>
      m.role === 'user'
        ? `Participant: ${m.content}`
        : `Colleague: ${m.raw ?? m.content}`,
    )
    .join('\n');

  const criteriaBlock = criteria
    .map((c) => `- criterionId: "${c.id}"\n  ${c.title}: ${c.description}`)
    .join('\n\n');

  const { object } = await generateObject({
    model: openai('gpt-5.6-terra'),
    schema: verdictBatchSchema,
    prompt: `You are evaluating an AI colleague's behavior in a simulated workplace chat conversation.

CRITERIA (evaluate the colleague against EACH one):
${criteriaBlock}

CONVERSATION (Participant = study participant, Colleague = AI being evaluated):
${transcript}

Each "Colleague:" line is the colleague's VERBATIM model output for that turn (the raw JSON the
model produced, before any rendering).

For EACH criterion above, evaluate whether the Colleague satisfied or violated it across the ENTIRE
conversation. Look at all colleague messages, not just the last one.

Applicability: some criteria are conditional — they only apply when the participant does something
that puts them to the test (e.g. attempts to override the rules, requests a draft, asks a direct
question). If the conversation never triggers a given criterion, set applicable=false for it rather
than awarding a vacuous pass. Do NOT mark a criterion as passed when nothing in the conversation
exercised it.

Two things this does NOT excuse: (1) a criterion describing the colleague's baseline behavior —
information gating, tone/character, response format — always applies, because every colleague turn
has a tone and a format. (2) For a response-format criterion, a colleague turn that is not a valid
JSON array of strings is a FAIL, never "not applicable" — the presence of non-JSON output is itself
the violation.

Return exactly one verdict per criterion. Set each verdict's criterionId to the exact id shown above.`,
    providerOptions: {
      openai: { reasoningEffort: 'low' },
    },
  });

  return criteria.map((c) => {
    const v = object.verdicts.find((x) => x.criterionId === c.id);
    if (!v) throw new Error(`Model omitted a verdict for criterion "${c.id}"`);
    return {
      criterionId: c.id,
      criterionTitle: c.title,
      applicable: v.applicable,
      pass: v.pass,
      evidence: v.evidence,
      concern: v.concern,
    };
  });
}

// Parse positional args plus an optional `--label <name>`. The label namespaces which run's logs
// are read and where judgments are written (see below), mirroring simulate.ts. Characters are
// restricted to what's safe in a filename prefix — no `_` (collides with the archetype separator).
function parseArgs(argv: string[]): { args: string[]; label?: string } {
  const positional: string[] = [];
  let label: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--label') {
      label = argv[++i];
      if (!label || !/^[A-Za-z0-9-]+$/.test(label)) {
        console.error('--label must be a non-empty name using only letters, digits, and hyphens.');
        process.exit(1);
      }
    } else {
      positional.push(argv[i]);
    }
  }
  return { args: positional, label };
}

async function main() {
  const { args, label } = parseArgs(process.argv.slice(2));
  if (args.length < 1) {
    console.error('Usage: npx tsx scripts/scenario_design/judge.ts <scenario-id> [archetype-id] [--label <name>]');
    process.exit(1);
  }

  const scenarioId = args[0];
  const archetypeFilter = args[1];
  // Read the logs and write the judgments for this run's namespace. `--label test` reads
  // outputs/<scenario>.<label>_<archetype>.json (written by `simulate.ts --label test`) and writes
  // <scenario>.<label>_judgments.json, leaving the real logs/judgments untouched.
  const ns = label ? `${scenarioId}.${label}` : scenarioId;

  const criteria = loadCriteria();
  console.log(`Loaded ${criteria.length} criteria from criteria.md`);

  // Tripwire: 0 criteria means every conversation is judged against nothing and "passes"
  // vacuously. Fail loud rather than silently green.
  if (criteria.length === 0) {
    console.error('No criteria parsed from criteria.md — refusing to run (results would be vacuous).');
    process.exit(1);
  }

  // Find conversation logs. Exclude this pipeline's own result files (`_judgments.json`,
  // `_probes.json`) — they share the `${scenarioId}_` prefix but are not ConversationLogs,
  // and parsing them as logs crashes the judge (their `.messages` is undefined).
  const logFiles = readdirSync(OUTPUTS_DIR)
    .filter(
      (f) =>
        f.startsWith(`${ns}_`) &&
        f.endsWith('.json') &&
        !f.includes('judgment') &&
        !f.includes('probes'),
    )
    .filter((f) => !archetypeFilter || f.includes(`_${archetypeFilter}.json`));

  if (logFiles.length === 0) {
    console.error(`No conversation logs found for "${scenarioId}". Run simulate.ts first.`);
    process.exit(1);
  }

  const allResults: Record<string, Verdict[]> = {};

  for (const file of logFiles) {
    const log: ConversationLog = JSON.parse(readFileSync(resolve(OUTPUTS_DIR, file), 'utf-8'));
    if (!Array.isArray(log.messages)) {
      console.warn(`  ! Skipping ${file}: not a conversation log (no messages array)`);
      continue;
    }
    console.log(`\nJudging: ${log.archetypeName} (${log.archetypeId})`);

    const verdicts = await judgeConversationAll(log, criteria);
    for (const verdict of verdicts) {
      const icon = !verdict.applicable ? '–' : verdict.pass ? '✓' : '✗';
      console.log(`  ${icon} ${verdict.criterionTitle}${verdict.concern ? ': ' + verdict.concern : ''}`);
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
      const label = !verdict ? '  ??  ' : verdict.applicable === false ? '  N/A  ' : verdict.pass ? '  PASS  ' : '  FAIL  ';
      return label.padEnd(10);
    });
    console.log([criterion.title.padEnd(30).slice(0, 30), ...cells].join(' | '));
  }

  // Count failures. A criterion that was never exercised (applicable === false) is neither a
  // pass nor a fail — exclude it so un-triggered conditional criteria don't count either way.
  // `applicable === undefined` (older judgment data without the field) is treated as applicable.
  const totalFailures = Object.values(allResults)
    .flat()
    .filter((v) => v.applicable !== false && !v.pass).length;

  console.log(`\nTotal failures: ${totalFailures}`);

  // Coverage check: a criterion that is N/A in EVERY conversation was never actually exercised.
  // With the N/A change this no longer shows as a false pass — but it can still be a silent hole,
  // because the phase looks green when nothing tested the criterion. Split the two cases via the
  // archetypes' `stresses` contract:
  //   - stressed by some archetype but never exercised → real coverage GAP (a flaky sim); fails.
  //   - not stressed by any archetype → delegated to probe.ts (e.g. resistance_to_manipulation);
  //     expected to be N/A here, so just remind the operator to run probes.
  // Only authoritative on a full run — a single-archetype run legitimately can't exercise everything.
  let coverageFailure = false;
  if (!archetypeFilter) {
    const stressedTitles = new Set(ARCHETYPES.flatMap((a) => a.stresses));
    const gaps: string[] = [];
    const delegated: string[] = [];
    for (const criterion of criteria) {
      const everApplicable = Object.values(allResults)
        .flat()
        .some((v) => v.criterionId === criterion.id && v.applicable !== false);
      if (everApplicable) continue;
      (stressedTitles.has(criterion.title) ? gaps : delegated).push(criterion.title);
    }

    console.log('\nCOVERAGE');
    console.log('-'.repeat(70));
    if (gaps.length === 0 && delegated.length === 0) {
      console.log('  ✓ Every criterion was exercised by at least one conversation.');
    }
    for (const title of delegated) {
      console.log(`  – ${title}: not exercised here — delegated to probe.ts. Run: npx tsx scripts/scenario_design/probe.ts ${scenarioId}`);
    }
    for (const title of gaps) {
      console.log(`  ⚠ ${title}: NEVER EXERCISED, yet an archetype is declared to stress it — coverage gap (likely a flaky simulation).`);
    }
    coverageFailure = gaps.length > 0;
  }

  // Write detailed results. Merge into any existing file so a single-archetype run
  // (`judge.ts <scenario> <archetype>`) updates just that entry instead of clobbering
  // the whole aggregate written by a full run.
  const outPath = resolve(OUTPUTS_DIR, `${ns}_judgments.json`);
  const existing: Record<string, Verdict[]> = existsSync(outPath)
    ? JSON.parse(readFileSync(outPath, 'utf-8'))
    : {};
  const merged = { ...existing, ...allResults };
  writeFileSync(outPath, JSON.stringify(merged, null, 2) + '\n');
  console.log(`Detailed results: ${outPath}`);

  if (totalFailures > 0) {
    console.log(
      `\nTo fix: point a coding agent at ${outPath} (each failure has evidence + concern) ` +
        'and have it revise the scenario systemPromptLines. Instruct it to come up with testable hypotheses about what went wrong and how to fix it.',
    );
  }
  if (coverageFailure) {
    console.log(
      '\nCoverage gap: a criterion an archetype is declared to stress was never exercised. ' +
        'Fix the archetype/system prompt so the simulation triggers it, or move that criterion to a deterministic probe.',
    );
  }

  process.exit(totalFailures > 0 || coverageFailure ? 1 : 0);
}

// Only run when executed directly, not when imported (e.g. by probe.ts).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
