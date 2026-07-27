/**
 * Phase 1: Generate a scenario JSON entry from a situation description + criteria.
 *
 * Reads a situation file (plain-English scenario description) and criteria.md,
 * then prompts the LLM to produce a complete scenarios.json entry.
 *
 * Usage:
 *   npx tsx scripts/scenario_design/generate.ts <situation-file> [scenario-id]
 *
 * Example:
 *   npx tsx scripts/scenario_design/generate.ts scripts/scenario_design/situations/roomDoubleBooking.md roomDoubleBooking
 *
 * Output: scripts/scenario_design/outputs/<scenario-id>.json
 */

import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, basename } from 'path';
import scenariosData from '../../lib/scenarios.json';

const OUTPUTS_DIR = resolve(import.meta.dirname, 'outputs');

// Use the first scenario as a structural reference (strip the actual content)
const exampleEntry = Object.values(scenariosData)[0];
const exampleStructure = JSON.stringify(exampleEntry, null, 2);

async function generate(situationPath: string, scenarioId: string) {
  const situation = readFileSync(situationPath, 'utf-8');
  const criteria = readFileSync(resolve(import.meta.dirname, 'criteria.md'), 'utf-8');

  const prompt = `You are a research assistant helping design a validated scenario for a user study.

The study has participants chat with an AI "colleague" to gather information, then write a professional email.
You need to generate a complete scenario configuration JSON entry.

## Situation Description

${situation}

## Colleague Conversation Criteria (must be embedded as behavioral rules in the systemPrompt)

${criteria}

## Output Format

Generate a JSON object matching this structure exactly (same fields, same nesting):

${exampleStructure}

Key requirements for the systemPrompt (stored as "systemPromptLines", an array of strings, one per line):
- Open with the colleague's identity and the situation in one sentence
- SCENARIO CONTEXT section: pin ALL key facts that affect the email content. Include plausible follow-up details participants might ask about (contacts, background, logistics). For anything truly unpredictable, include a line: "Make up any reasonable details if needed, but keep them consistent with the scenario"
- YOUR ROLE section: embed all the behavioral criteria above as bullet points
- RESPONSE FORMAT section: instruct JSON array of message strings, with examples appropriate to this scenario

The "analysis" field should contain the context and key facts a grader would need to evaluate the resulting email.

Return ONLY the JSON object, no markdown fences.`;

  console.log(`Generating scenario "${scenarioId}" from ${basename(situationPath)}...`);

  const result = await generateText({
    model: openai('gpt-4o'),
    prompt,
    maxOutputTokens: 4000,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(result.text.trim());
  } catch {
    console.error('Failed to parse LLM output as JSON. Raw output:');
    console.error(result.text);
    process.exit(1);
  }

  // Ensure the id field matches
  parsed.id = scenarioId;

  mkdirSync(OUTPUTS_DIR, { recursive: true });
  const outPath = resolve(OUTPUTS_DIR, `${scenarioId}.json`);
  writeFileSync(outPath, JSON.stringify(parsed, null, 2) + '\n');
  console.log(`Wrote ${outPath}`);
  console.log('\nReview the output, then run simulate.ts to test it.');
}

// --- CLI ---
const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: npx tsx scripts/scenario_design/generate.ts <situation-file> [scenario-id]');
  process.exit(1);
}
const situationPath = resolve(args[0]);
const scenarioId = args[1] || basename(situationPath, '.md');

generate(situationPath, scenarioId).catch((err) => {
  console.error(err);
  process.exit(1);
});
