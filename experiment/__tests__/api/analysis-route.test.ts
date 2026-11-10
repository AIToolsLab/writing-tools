/**
 * The researcher-only OpenAI passthrough used by scripts/log-viewer.html.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPTIONS, POST } from '@/app/api/analysis/chat/completions/route';

function req(auth?: string, body: unknown = { model: 'm', messages: [] }) {
  return new Request('http://localhost/api/analysis/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'sk-test');
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), {
    status: 200, headers: { 'content-type': 'application/json' },
  }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/analysis/chat/completions', () => {
  it('is disabled when ANALYSIS_TOKEN is unset', async () => {
    vi.stubEnv('ANALYSIS_TOKEN', '');
    const res = await POST(req('Bearer anything'));
    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a missing or wrong token', async () => {
    vi.stubEnv('ANALYSIS_TOKEN', 'secret');
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req('Bearer nope'))).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards the body to OpenAI with the server key and allows any origin', async () => {
    vi.stubEnv('ANALYSIS_TOKEN', 'secret');
    const body = { model: 'gpt-x', messages: [{ role: 'user', content: 'hi' }] };
    const res = await POST(req('Bearer secret', body));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toEqual({ choices: [{ message: { content: '{}' } }] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it('passes upstream errors through', async () => {
    vi.stubEnv('ANALYSIS_TOKEN', 'secret');
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"bad model"}}', { status: 404, headers: { 'content-type': 'application/json' } }));
    const res = await POST(req('Bearer secret'));
    expect(res.status).toBe(404);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('answers CORS preflight', () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-headers')).toContain('Authorization');
  });
});
