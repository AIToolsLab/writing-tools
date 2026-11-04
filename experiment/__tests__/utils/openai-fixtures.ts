/**
 * A fake OpenAI at the HTTP layer, for tests that must survive AI SDK upgrades.
 *
 * These tests stub `fetch` with OpenAI wire-format responses instead of using
 * the SDK's `MockLanguageModelV*`. The wire format is OpenAI's and doesn't move
 * when we bump `ai` / `@ai-sdk/openai`, so the same fixtures and assertions
 * should pass before and after an upgrade — which is what makes them evidence
 * that the upgrade didn't break anything. A model mock would skip
 * `@ai-sdk/openai`'s request building and response parsing (the code an upgrade
 * changes) and is itself renamed across SDK majors.
 *
 * The fixtures in `../fixtures/openai/` are currently handmade. See
 * docs/ai-sdk-upgrade-tests.md for how to replace them with recorded ones.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';

const FIXTURE_DIR = path.join(__dirname, '../fixtures/openai');

export function readFixture(name: string): string {
  return readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
}

/**
 * The full text OpenAI reported for a streamed response, read from the
 * fixture's `response.output_text.done` events. Tests compare against this
 * rather than a hard-coded string so a re-recorded fixture needs no test edits.
 */
export function streamedText(sse: string): string {
  return sse
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)))
    .filter((event) => event.type === 'response.output_text.done')
    .map((event) => event.text)
    .join('');
}

/** The `output_text` of a non-streamed Responses API body. */
export function outputText(json: string): string {
  const body = JSON.parse(json);
  return body.output
    .filter((item: { type: string }) => item.type === 'message')
    .flatMap((item: { content: { type: string; text: string }[] }) => item.content)
    .filter((part: { type: string }) => part.type === 'output_text')
    .map((part: { text: string }) => part.text)
    .join('');
}

/** An SSE response, delivered in a few chunks so the SDK's parser has to reassemble events. */
export function sseResponse(body: string): Response {
  const encoder = new TextEncoder();
  const chunks = body.match(/[\s\S]{1,200}/g) ?? [];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

export function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface OpenAICall {
  url: string;
  body: Record<string, unknown>;
}

/**
 * Stub the global `fetch` so every request to OpenAI gets `respond()`'s answer,
 * and record what was sent. Returns the recorded calls.
 */
export function stubOpenAI(respond: () => Response): OpenAICall[] {
  const calls: OpenAICall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith('https://api.openai.com/')) {
        throw new Error(`Unexpected fetch in test: ${url}`);
      }
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return respond();
    }),
  );
  return calls;
}
