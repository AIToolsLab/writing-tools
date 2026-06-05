# Better Auth → PR #448 Integration Notes

This playground (`playgrounds/better-auth-hono/`) proves that Better Auth can be
layered onto the Hono backend shape introduced in PR #448 with minimal changes.

All four milestones passed in the playground:

- **M1** — Better Auth mounts at `/api/auth/*` inside a Hono server without conflicting with existing routes.
- **M2** — Google OAuth completes end-to-end (redirect → callback → session cookie set).
- **M3** — `auth.api.getSession()` correctly verifies sessions in Hono route handlers: cookie → 200, no auth → 401, Bearer token → 200.
- **M4** — Auth guard works in front of an OpenAI-compatible SSE route.

This document describes what it would take to integrate that auth layer into
PR #448's `backend/`. **This is a design note, not a ready-to-merge plan.**
Read the open questions at the bottom before treating any step as production-ready.

---

## What PR #448 currently has

From `backend/src/app.ts` (branch `claude/backend-hono-migration-QE061`):

- `POST /api/openai/chat/completions` — real OpenAI passthrough proxy
- `POST /api/log` — JSONL study logging
- `GET /api/ping` — health check
- `POST /api/logs_poll` — `LOG_SECRET`-gated researcher tool
- `GET /api/download_logs` — `LOG_SECRET`-gated ZIP export
- `app.use('*', cors())` — fully permissive CORS, no credentials

It does **not** include Better Auth, Google OAuth, session verification, or any
auth route mounting. The CORS comment in the file says explicitly: "no backend
auth yet".

---

## Stage 1 — Mount Better Auth, add a test route only

**Do not guard `/api/openai/chat/completions` yet.** The frontend does not send
a Better Auth session or Bearer token today. Guarding that route before the
frontend is updated would immediately break Chat/Draft/Revise for all users.

Stage 1 only adds auth alongside existing routes without touching them.

### 1. Install dependencies

```bash
cd backend
npm install better-auth better-sqlite3
npm install -D @types/better-sqlite3
```

### 2. Add `backend/src/auth.ts`

```ts
import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const auth = betterAuth({
  // db/ lives at backend/db/, one level up from backend/src/
  database: new Database(path.join(__dirname, "../db/auth.db")),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:8000",
  secret: process.env.BETTER_AUTH_SECRET,
  plugins: [bearer()],
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    },
  },
});
```

Run `npx @better-auth/cli migrate` after adding this file to create the SQLite
tables (`user`, `session`, `account`, `verification`).

> **DB path note:** `path.join(__dirname, "../db/auth.db")` resolves to
> `backend/db/auth.db`. Do not use `"../../db/auth.db"` — that would resolve
> to the repo root, not the backend directory.

### 3. Mount auth routes in `backend/src/app.ts`

Inside `createApp()`, add one import and one route before the existing routes:

```ts
// add at top of file
import { auth } from "./auth.js";

// add inside createApp(), before the existing app.post/app.get calls
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// optional: add a test-only protected route to verify session checking works
// remove this before merging to production
app.get("/api/protected", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  return c.json({ email: session.user.email, name: session.user.name });
});
```

Better Auth handles all OAuth redirects, callbacks, session reads, and sign-out
under `/api/auth/*` automatically.

### 4. Add env vars to `backend/.env`

```
BETTER_AUTH_SECRET=<generate with: openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:8000
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
```

Also add these keys to `scripts/get_env.py` so they are populated in CI/Docker.

---

## Stage 2 — Guard `/api/openai/chat/completions` (later, after frontend is ready)

Only add this guard after the frontend sends a Better Auth session cookie or
Bearer token with every request to that route.

```ts
app.post('/api/openai/chat/completions', async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  // existing proxy code unchanged below
  const body = await c.req.text();
  ...
});
```

The `bearer()` plugin means this guard handles both cookie sessions (browser)
and Bearer token sessions (Word add-in or programmatic clients) with the same
single call.

> **Test impact:** PR #448's existing OpenAI proxy test sends unauthenticated
> requests and expects 200. Adding this guard will break that test. The test
> will need to be updated to cover both `401 without auth` and `200 with a
> valid session`.

---

## Open questions before Stage 1 is production-ready

### CORS

PR #448 uses `cors()` with no options (fully permissive). Once auth is added,
CORS needs `credentials: true` and an explicit `origin` list — otherwise the
browser will not send or receive session cookies.

```ts
app.use('*', cors({
  origin: [process.env.FRONTEND_ORIGIN ?? "http://localhost:3000"],
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  credentials: true,
}));
```

However, the real origin list needs careful thought:

- Word add-in local dev uses `https://localhost:3000` (HTTPS, not HTTP)
- Word add-in in production may be same-origin behind nginx
- Google Docs has a separate origin (Apps Script/iframe context)
- The researcher log viewer tool may have its own origin

Do not copy the CORS config from this playground directly. The playground uses
`http://localhost:3001` as a single-origin convenience. Production CORS is
a separate decision.

### Docker and database persistence

PR #448's `Dockerfile` and `docker-compose` do not provision a `db/` directory
or volume mount for SQLite. Before deploying Better Auth with SQLite:

- The `backend/db/` directory must exist in the container
- A volume should be mounted so sessions survive container restarts
- `better-sqlite3` is a native Node addon — verify it builds correctly in the
  Node slim Docker image PR #448 uses

### Auth0 migration

Better Auth replaces Auth0, which currently lives in the frontend
(`@auth0/auth0-react`). Replacing the frontend auth client is a separate step
from adding Better Auth to the backend. Do not remove Auth0 as part of Stage 1.

The Word add-in login flow has Office dialog constraints that need separate
investigation before Auth0 can be removed.

---

## What this does NOT change in PR #448

- JSONL logging (`logging.ts`) — untouched
- PostHog telemetry (`posthog.ts`) — untouched
- `LOG_SECRET`-gated viewer routes — untouched
- Docker / compose / nginx — untouched (but see open questions above)
- The `createApp()` factory pattern — auth just mounts inside it
- Existing unauthenticated behavior of `/api/openai/chat/completions` — Stage 1
  leaves this route ungated
