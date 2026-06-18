import { Hono } from "hono";
import { auth } from "../auth.js";

const chat = new Hono();

// Milestone 4 — mirrors FastAPI's POST /api/openai/chat/completions.
// Auth-gated: verifies session before processing.
// Returns a mock OpenAI-compatible streaming response — no real API key used.
//
// Note: the Next.js migration branch (PR #445) uses cleaner route shapes:
//   POST /api/chat    — UI message stream
//   POST /api/draft   — one-shot JSON suggestion
//   POST /api/revise  — text stream
// A future Hono milestone can compare those shapes against this FastAPI-mirrored route.
chat.post("/", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  // Mock OpenAI-compatible SSE stream response.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const mockChunks = [
        { choices: [{ delta: { content: "Hello " }, finish_reason: null }] },
        { choices: [{ delta: { content: "from " }, finish_reason: null }] },
        { choices: [{ delta: { content: "Hono! " }, finish_reason: null }] },
        { choices: [{ delta: { content: `(user: ${session.user.email})` }, finish_reason: null }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ];

      for (const chunk of mockChunks) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`)
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
});

export default chat;
