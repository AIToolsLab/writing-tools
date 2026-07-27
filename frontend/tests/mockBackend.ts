import { Page, Route } from '@playwright/test';

/**
 * Mock the OpenAI-compatible endpoint the frontend now talks to.
 *
 * The frontend uses the AI SDK's OpenAI provider (src/api/openai.ts) pointed at
 * `${SERVER_URL}/openai`, via `openai.responses()`, and calls streamText(). So the
 * real wire request is a POST to `/api/openai/responses` with a Responses-API body
 * (`instructions` for the system prompt, `input` for the message turns), and the
 * response must be a Responses-API SSE stream (`response.output_text.delta` events).
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

// The Responses request body carries the prompt in two places: the system prompt as
// `instructions`, and the message turns as `input`, each turn's content an array of
// parts ({ type: 'input_text' | 'output_text', text }). Flatten all of it to text.
type ResponsesBody = {
  instructions?: string;
  input?: Array<{ content?: string | Array<{ text?: string }> }>;
};

function textFromRequest(body: ResponsesBody): string {
  const parts: string[] = [];
  if (body.instructions) parts.push(body.instructions);
  for (const turn of body.input ?? []) {
    if (typeof turn.content === 'string') parts.push(turn.content);
    else for (const p of turn.content ?? []) if (p.text) parts.push(p.text);
  }
  return parts.join('\n');
}

// gtype is no longer sent in the request; infer it from distinctive prompt text.
// Draft prompts live in src/api/prompts.ts; Chat and Revise build their own
// system/user messages in their page components.
function resultForText(text: string): string {
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

// Frame text as a Responses-API SSE stream so the AI SDK's responses provider can
// parse it: open a message item, stream one text delta, then complete with usage.
function sseFromText(text: string): string {
  const event = (payload: object) => `data: ${JSON.stringify(payload)}\n\n`;
  return (
    event({
      type: 'response.created',
      response: { id: 'resp-mock', created_at: 0, model: 'gpt-5.6-terra' },
    }) +
    event({
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'message', id: 'msg-mock' },
    }) +
    event({
      type: 'response.output_text.delta',
      item_id: 'msg-mock',
      delta: text,
    }) +
    event({
      type: 'response.completed',
      response: { usage: { input_tokens: 0, output_tokens: 0 } },
    }) +
    'data: [DONE]\n\n'
  );
}

/**
 * Fulfill an intercepted /openai/responses route with an SSE stream.
 * Exported so tests that need custom behavior (e.g. an added delay) can reuse it.
 */
export async function fulfillOpenAI(route: Route, result: string) {
  await route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    body: sseFromText(result),
  });
}

/**
 * The failure mode that motivated the error-visibility work: OpenAI answers 200
 * and then reports the failure as an `error` event inside the SSE stream. The
 * AI SDK forwards it as an error part rather than throwing, so a page that
 * ignores those parts renders nothing at all.
 */
export const QUOTA_ERROR_MESSAGE =
  'You exceeded your current quota, please check your plan and billing details.';

export async function fulfillOpenAIStreamError(route: Route) {
  const event = (payload: object) => `data: ${JSON.stringify(payload)}\n\n`;
  await route.fulfill({
    status: 200,
    headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    body:
      event({
        type: 'response.created',
        response: { id: 'resp-mock', created_at: 0, model: 'gpt-5.6-terra' },
      }) +
      event({
        type: 'error',
        sequence_number: 2,
        error: {
          type: 'insufficient_quota',
          code: 'insufficient_quota',
          message: QUOTA_ERROR_MESSAGE,
        },
      }) +
      'data: [DONE]\n\n',
  });
}

export async function setupMockBackend(page: Page) {
  // Demo pages mint an anonymous Better Auth session on load (src/api/anonymousAuth.ts).
  // The Playwright "backend" is just http-server over dist/, which 405s a POST, so the
  // real auth server never answers here — stand in for it. The frontend only needs a
  // 2xx plus the bearer token in the `set-auth-token` header (the bearer plugin's contract).
  await page.route('**/auth/sign-in/anonymous', async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        'content-type': 'application/json',
        'set-auth-token': 'mock-anonymous-token',
      },
      body: JSON.stringify({ user: { id: 'mock-anon-user', isAnonymous: true } }),
    });
  });

  // Right after signing in, the frontend verifies the token and loads the user via
  // GET /auth/get-session (src/api/deviceAuth.ts fetchUserInfo). Without this, http-server
  // 404s and the demo lands on the "Oops... get-session failed (404)" error screen.
  // Shape mirrors Better Auth's get-session body: a nested `user`.
  await page.route('**/auth/get-session', async (route) => {
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user: { id: 'mock-anon-user', loggingConsent: 'usage' },
      }),
    });
  });

  await page.route('**/openai/responses', async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as ResponsesBody;
    await fulfillOpenAI(route, resultForText(textFromRequest(body)));
  });
}
