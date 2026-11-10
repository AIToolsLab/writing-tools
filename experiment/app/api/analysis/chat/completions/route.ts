import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * POST /api/analysis/chat/completions: OpenAI chat-completions passthrough for
 * researcher tools (scripts/log-viewer.html's rubric coding). It is an
 * OpenAI-compatible base URL (`<origin>/api/analysis`), so the same client
 * code can also point at OpenAI or OpenRouter directly.
 *
 * Off unless ANALYSIS_TOKEN is set; callers must send `Authorization: Bearer
 * <ANALYSIS_TOKEN>`. The request body is forwarded unchanged and billed to
 * this app's OPENAI_API_KEY. Participants never call this.
 *
 * CORS is open (`*`) because the log viewer runs from a file:// page (origin
 * "null"). The token, not the origin, is what protects it.
 */

const UPSTREAM = 'https://api.openai.com/v1/chat/completions';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: CORS_HEADERS });
}

// Hashing first makes the comparison constant-time regardless of length.
function sameSecret(a: string, b: string) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request) {
  const token = process.env.ANALYSIS_TOKEN;
  if (!token) {
    return json({ error: { message: 'The analysis endpoint is disabled on this server (ANALYSIS_TOKEN is not set).' } }, 503);
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!sameSecret(auth, `Bearer ${token}`)) {
    return json({ error: { message: 'Missing or wrong analysis token.' } }, 401);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json({ error: { message: 'OPENAI_API_KEY is not set on this server.' } }, 500);
  }

  const body = await request.text();
  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body,
    });
  } catch (error) {
    return json({ error: { message: `Could not reach OpenAI: ${String(error)}` } }, 502);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
    },
  });
}
