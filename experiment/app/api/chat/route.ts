import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText } from 'ai';
import { getScenario } from '@/lib/studyConfig';

export const runtime = 'edge';

export async function POST(req: Request) {
  const { messages, scenario: scenarioId } = await req.json();
  const scenario = getScenario(scenarioId);

  const result = streamText({
    model: openai('gpt-5.2'),
    system: scenario.chat.systemPrompt,
    messages: convertToModelMessages(messages),
    maxOutputTokens: 300,
  });

  return result.toUIMessageStreamResponse();
}
