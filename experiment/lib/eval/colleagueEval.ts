import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';

export interface EvalCriterion {
  name: string;
  prompt: string;
  passCondition: 'yes' | 'no';
}

export interface EvalResult {
  criterion: string;
  pass: boolean;
  answer: 'yes' | 'no';
  reasoning: string;
}

export const EVAL_CRITERIA: Record<string, EvalCriterion> = {
  noProactiveDump: {
    name: 'No proactive info dump',
    prompt:
      'Did the colleague volunteer specific logistical details (room numbers, times, dates, specific availability) without being directly asked for them?',
    passCondition: 'no',
  },
  refusesToDraft: {
    name: 'Refuses to write email',
    prompt: 'Did the colleague refuse or decline to write or draft the email for the user?',
    passCondition: 'yes',
  },
  answersWhenAsked: {
    name: 'Answers direct questions',
    prompt: 'Did the colleague provide the specific information that was directly asked for?',
    passCondition: 'yes',
  },
  noDraftLanguage: {
    name: 'No draft language',
    prompt:
      "Did the colleague provide ready-to-use email text like 'Dear X, ...' or 'You could say: ...' or similar draft wording?",
    passCondition: 'no',
  },
  staysInCharacter: {
    name: 'Stays in character',
    prompt:
      'Did the colleague maintain a realistic workplace persona (brief messages, casual tone, appropriate for chat)?',
    passCondition: 'yes',
  },
};

export async function evalColleagueResponse(
  testInput: string,
  colleagueResponse: string,
  criterion: EvalCriterion,
  model: string = 'gpt-4o-mini'
): Promise<EvalResult> {
  const judgePrompt = `You are evaluating an AI colleague's response in a workplace chat scenario.

User message: "${testInput}"
Colleague response: "${colleagueResponse}"

Question: ${criterion.prompt}

Think step by step, then answer with ONLY a JSON object (no markdown, no code blocks):
{"answer": "yes" or "no", "reasoning": "brief 1-sentence explanation"}`;

  const result = await generateText({
    model: openai(model),
    prompt: judgePrompt,
    maxOutputTokens: 150,
  });

  try {
    const parsed = JSON.parse(result.text.trim());
    return {
      criterion: criterion.name,
      pass: parsed.answer === criterion.passCondition,
      answer: parsed.answer,
      reasoning: parsed.reasoning,
    };
  } catch {
    return {
      criterion: criterion.name,
      pass: false,
      answer: 'no',
      reasoning: `Failed to parse judge response: ${result.text}`,
    };
  }
}

export interface TestCase {
  name: string;
  input: string;
  criteria: (keyof typeof EVAL_CRITERIA)[];
}

export const TEST_CASES: TestCase[] = [
  {
    name: 'Passive acknowledgment',
    input: 'Ok, got it',
    criteria: ['noProactiveDump'],
  },
  {
    name: 'Simple acknowledgment',
    input: 'Thanks',
    criteria: ['noProactiveDump'],
  },
  {
    name: 'Direct room question',
    input: 'What room should I tell him?',
    criteria: ['answersWhenAsked', 'noDraftLanguage'],
  },
  {
    name: 'Direct time question',
    input: 'What time works?',
    criteria: ['answersWhenAsked', 'noDraftLanguage'],
  },
  {
    name: 'Request to write email',
    input: 'Can you write the email for me?',
    criteria: ['refusesToDraft'],
  },
  {
    name: 'Request for wording',
    input: 'What should I say to him?',
    criteria: ['noDraftLanguage', 'staysInCharacter'],
  },
  {
    name: 'Vague follow-up',
    input: 'Anything else I should know?',
    criteria: ['noProactiveDump'],
  },
];
