import { Page, Route } from '@playwright/test';

/**
 * Mock the OpenAI-compatible endpoint the frontend now talks to.
 *
 * The frontend uses the AI SDK's OpenAI provider (src/api/openai.ts) pointed at
 * `${SERVER_URL}/openai`, and calls streamText(). So the real wire request is a
 * POST to `/api/openai/chat/completions` with an OpenAI chat-completions body,
 * and the response must be an OpenAI-format SSE stream.
 */

const RESULTS = {
  example_sentences:
    '- First example suggestion\n\n- Second example suggestion\n\n- Third example suggestion',
  analysis_readerPerspective:
    '- First reader perspective\n\n- Second reader perspective\n\n- Third reader perspective',
  proposal_advice:
    '- First piece of advice\n\n- Second piece of advice\n\n- Third piece of advice',
  example_rewording:
    '- First rewording option\n\n- Second rewording option\n\n- Third rewording option',
  // Revise (visualization): includes a doctext link like the real responses do.
  revise:
    '- A mock structural observation about your document.\n\n- [opening line](doctext:Some%20text%20to%20analyze) could be expanded.',
  // Chat assistant reply.
  chat: 'This is a mock assistant reply about your document.',
};

// gtype is no longer sent in the request; infer it from distinctive prompt text.
// Draft prompts live in src/api/prompts.ts; Chat and Revise build their own
// system/user messages in their page components.
function resultForMessages(messages: { content: string }[]): string {
  const text = messages.map((m) => m.content).join('\n');
  if (text.includes('inspiring and fresh possible next sentences'))
    return RESULTS.example_sentences;
  if (text.includes('questions the person might have'))
    return RESULTS.analysis_readerPerspective;
  if (text.includes('directive (but not prescriptive) advice'))
    return RESULTS.proposal_advice;
  if (text.includes('three alternative rewordings'))
    return RESULTS.example_rewording;
  // Revise wraps the document in <writer-doc-so-far> tags (revise/index.tsx).
  if (text.includes('<writer-doc-so-far>')) return RESULTS.revise;
  // Chat is identified by its system prompt (chat/index.tsx).
  if (text.includes('Encourage the user towards critical thinking'))
    return RESULTS.chat;
  return '';
}

// Frame text as an OpenAI chat-completions SSE stream so the AI SDK can parse it.
function sseFromText(text: string): string {
  const base = {
    id: 'chatcmpl-mock',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'gpt-4o',
  };
  const chunk = (delta: object, finish: string | null = null) =>
    `data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;
  return chunk({ role: 'assistant', content: text }) + chunk({}, 'stop') + 'data: [DONE]\n\n';
}

/**
 * Fulfill an intercepted /openai/chat/completions route with an SSE stream.
 * Exported so tests that need custom behavior (e.g. an added delay) can reuse it.
 */
export async function fulfillOpenAI(route: Route, result: string) {
  await route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    body: sseFromText(result),
  });
}

export async function setupMockBackend(page: Page) {
  await page.route('**/openai/chat/completions', async (route) => {
    const messages = (route.request().postDataJSON()?.messages ?? []) as {
      content: string;
    }[];
    await fulfillOpenAI(route, resultForMessages(messages));
  });
}
