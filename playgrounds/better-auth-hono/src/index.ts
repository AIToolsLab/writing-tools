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

// CORS — allow the backend's own static pages (3001) AND the separate
// task-pane simulator origin (3002). The 3002 origin reproduces the Word
// task-pane / browser split: it has NO Better Auth cookie and must rely
// entirely on the bearer token returned by the device flow.
app.use(
  "*",
  cors({
    origin: ["http://localhost:3001", "http://localhost:3002"],
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
