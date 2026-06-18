import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "@hono/node-server/serve-static";
import { serve } from "@hono/node-server";
import { auth } from "./auth.js";
import ping from "./routes/ping.js";
import protected_ from "./routes/protected.js";
import chat from "./routes/chat.js";

const app = new Hono();
const PORT = 3001;

// CORS — allow the static test page and future frontend origins.
app.use(
  "*",
  cors({
    origin: [`http://localhost:${PORT}`],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  })
);

// Better Auth — handles all /api/auth/* routes (OAuth, session, sign-out).
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// API routes
app.route("/api/ping", ping);
app.route("/api/protected", protected_);
app.route("/api/openai/chat/completions", chat);

// Serve static test page (public/)
app.use("/*", serveStatic({ root: "./public" }));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Hono server running at http://localhost:${PORT}`);
  console.log(`Better Auth at http://localhost:${PORT}/api/auth`);
  console.log(`Health check: http://localhost:${PORT}/api/ping`);
});
