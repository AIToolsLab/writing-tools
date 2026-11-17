/**
 * The writing-support route against a fake OpenAI (see
 * __tests__/utils/openai-fixtures.ts): structured output in, bullet list out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/writing-support/route';
import {
  jsonResponse,
  outputText,
  readFixture,
  stubOpenAI,
} from '../utils/openai-fixtures';

function supportRequest(): Request {
  return new Request('http://localhost/api/writing-support', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      context: 'proposal_advice',
      editorState: {
        beforeCursor: 'Hi Jaden, unfortunately the room ',
        selectedText: '',
        afterCursor: '',
      },
    }),
  });
}

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  // The route logs failures; keep the expected one out of the test output.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/writing-support', () => {
  it('asks for a JSON-schema response and formats it as a bullet list', async () => {
    const fixture = readFixture('writing-support.json');
    const calls = stubOpenAI(() => jsonResponse(fixture));
    const { responses } = JSON.parse(outputText(fixture)) as {
      responses: string[];
    };
    expect(responses.length).toBeGreaterThan(0);

    const res = await POST(supportRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      suggestions: [responses.map((item) => `- ${item}`).join('\n\n')],
    });

    expect(calls).toHaveLength(1);
    const [{ url, body }] = calls;
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(body.model).toBe('gpt-5.2');
    expect(body.text).toMatchObject({ format: { type: 'json_schema' } });
    expect(JSON.stringify(body)).toContain('Hi Jaden, unfortunately the room ');
  });

  it('returns a 500 when OpenAI rejects the request', async () => {
    // 401 isn't retried, so this stays a single call with no backoff delay.
    stubOpenAI(() => jsonResponse(readFixture('invalid-api-key.json'), 401));

    const res = await POST(supportRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to generate suggestion' });
  });
});
