/**
 * Colleague Behavior Eval Script
 *
 * Tests that the colleague LLM behaves correctly:
 * - Doesn't volunteer information proactively
 * - Answers questions when asked
 * - Refuses to draft emails
 * - Stays in character
 *
 * Usage:
 *   npx tsx scripts/evalColleague.ts [scenario]
 *
 * Examples:
 *   npx tsx scripts/evalColleague.ts                    # Run all scenarios
 *   npx tsx scripts/evalColleague.ts roomDoubleBooking  # Run specific scenario
 */

import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { SCENARIOS } from '../lib/studyConfig';
import {
  EVAL_CRITERIA,
  TEST_CASES,
  evalColleagueResponse,
  type EvalResult,
} from '../lib/eval/colleagueEval';

interface ColleagueResponse {
  messages: string[];
  raw: string;
}

async function callColleague(
  systemPrompt: string,
  userMessage: string,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<ColleagueResponse> {
  const messages = [
    ...conversationHistory.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: userMessage },
  ];

  const result = await generateText({
    model: openai('gpt-5.2'),
    system: systemPrompt,
    messages,
    maxOutputTokens: 300,
  });

  const raw = result.text.trim();

  // Parse JSON array response
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return { messages: parsed, raw };
    }
    return { messages: [raw], raw };
  } catch {
    return { messages: [raw], raw };
  }
}

interface TestResult {
  testCase: string;
  input: string;
  colleagueResponse: string;
  evals: EvalResult[];
  allPassed: boolean;
}

async function runScenarioEval(scenarioId: string): Promise<TestResult[]> {
  const scenario = SCENARIOS[scenarioId as keyof typeof SCENARIOS];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioId}`);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scenario: ${scenarioId}`);
  console.log(`Colleague: ${scenario.colleague.name} (${scenario.colleague.role})`);
  console.log(`${'='.repeat(60)}\n`);

  const results: TestResult[] = [];

  // Build initial conversation context from the scenario's initial messages
  const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const msg of scenario.chat.initialMessages) {
    conversationHistory.push({ role: 'assistant', content: msg });
  }

  for (const testCase of TEST_CASES) {
    console.log(`Test: ${testCase.name}`);
    console.log(`  Input: "${testCase.input}"`);

    // Call the colleague
    const colleagueResponse = await callColleague(
      scenario.chat.systemPrompt,
      testCase.input,
      conversationHistory
    );

    const responseText = colleagueResponse.messages.join(' | ');
    console.log(`  Response: "${responseText}"`);

    // Run evals for this test case
    const evals: EvalResult[] = [];
    for (const criterionKey of testCase.criteria) {
      const criterion = EVAL_CRITERIA[criterionKey];
      const evalResult = await evalColleagueResponse(testCase.input, responseText, criterion);
      evals.push(evalResult);

      const icon = evalResult.pass ? '✓' : '✗';
      console.log(`  ${icon} ${evalResult.criterion}: ${evalResult.reasoning}`);
    }

    const allPassed = evals.every((e) => e.pass);
    results.push({
      testCase: testCase.name,
      input: testCase.input,
      colleagueResponse: responseText,
      evals,
      allPassed,
    });

    console.log('');
  }

  return results;
}

function printSummary(allResults: Map<string, TestResult[]>) {
  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60) + '\n');

  let totalTests = 0;
  let totalPassed = 0;

  for (const [scenarioId, results] of allResults) {
    const passed = results.filter((r) => r.allPassed).length;
    const total = results.length;
    totalTests += total;
    totalPassed += passed;

    const icon = passed === total ? '✓' : '✗';
    console.log(`${icon} ${scenarioId}: ${passed}/${total} tests passed`);

    // Show failures
    for (const result of results) {
      if (!result.allPassed) {
        console.log(`    ✗ ${result.testCase}`);
        for (const evalResult of result.evals) {
          if (!evalResult.pass) {
            console.log(`      - ${evalResult.criterion}: ${evalResult.reasoning}`);
          }
        }
      }
    }
  }

  console.log('');
  console.log(`Total: ${totalPassed}/${totalTests} tests passed`);

  return totalPassed === totalTests;
}

async function main() {
  const args = process.argv.slice(2);
  const specificScenario = args[0];

  const scenariosToTest = specificScenario
    ? [specificScenario]
    : Object.keys(SCENARIOS);

  const allResults = new Map<string, TestResult[]>();

  for (const scenarioId of scenariosToTest) {
    try {
      const results = await runScenarioEval(scenarioId);
      allResults.set(scenarioId, results);
    } catch (error) {
      console.error(`Error testing ${scenarioId}:`, error);
    }
  }

  const allPassed = printSummary(allResults);
  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
