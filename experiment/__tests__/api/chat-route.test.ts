/**
 * The chat route against a fake OpenAI (see __tests__/utils/openai-fixtures.ts).
 *
 * Assertions stick to what we or OpenAI own — the request body on the wire, the
 * HTTP status — and not to the SDK's UI stream format between route and
 * `useChat`, which may legitimately change in an upgrade. Whether that stream
 * still reaches the client intact is chat-roundtrip.test.tsx's job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/chat/route';
import { getScenario } from '@/lib/studyConfig';
import {
  readFixture,
  sseResponse,
  stubOpenAI,
} from '../utils/openai-fixtures';

const SCENARIO_ID = 'roomDoubleBooking';

function chatRequest(text: string): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scenario: SCENARIO_ID,
      messages: [
        { id: 'u1', role: 'user', parts: [{ type: 'text', text }] },
      ],
    }),
  });
}

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/chat', () => {
  it('sends the scenario model, prompt and limits to the Responses API', async () => {
    const calls = stubOpenAI(() => sseResponse(readFixture('chat-stream.sse')));
    const scenario = getScenario(SCENARIO_ID);

    const res = await POST(chatRequest('What time is the room free?'));
    // Drain the stream so the request has certainly been made and finished.
    await res.text();

    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    const [{ url, body }] = calls;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.model).toBe(scenario.chat.model);
    expect(body.stream).toBe(true);
    expect(body.max_output_tokens).toBe(300);
    expect(body.reasoning).toMatchObject({
      effort: scenario.chat.reasoningEffort,
    });

    // The system prompt and the writer's message both reach the model. Where
    // the SDK puts the system prompt (an `instructions` field, or a
    // system/developer input item) is its choice, so search the whole body.
    const sent = JSON.stringify(body);
    expect(sent).toContain(JSON.stringify(scenario.chat.systemPrompt).slice(1, -1));
    expect(sent).toContain('What time is the room free?');
  });
});
