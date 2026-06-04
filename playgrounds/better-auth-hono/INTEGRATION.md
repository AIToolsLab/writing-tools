# Better Auth → PR #448 Integration Notes

This playground (`playgrounds/better-auth-hono/`) proves that Better Auth can be
layered onto the Hono backend shape introduced in PR #448 with minimal changes.

All four milestones passed:

- **M1** — Better Auth mounts at `/api/auth/*` inside a Hono server without conflicting with existing routes.
- **M2** — Google OAuth completes end-to-end (redirect → callback → session cookie set).
- **M3** — `auth.api.getSession()` correctly verifies sessions in Hono route handlers: cookie → 200, no auth → 401, Bearer token → 200.
- **M4** — Auth guard works in front of an OpenAI-compatible SSE route.

---

## How to add Better Auth to `backend/`

### 1. Install dependencies

```bash
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
  database: new Database(path.join(__dirname, "../../db/auth.db")),
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

Run `npx @better-auth/cli migrate` after adding this to create the SQLite schema
(`user`, `session`, `account`, `verification` tables).

### 3. Mount auth routes in `backend/src/app.ts`

Add one import and one route registration inside `createApp()`:

```ts
// add at top
import { auth } from "./auth.js";

// add inside createApp(), before the existing routes
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));
```

Better Auth handles all OAuth redirects, callbacks, session reads, and sign-out
under `/api/auth/*` automatically. No individual route files needed.

### 4. Tighten CORS

PR #448 currently uses `cors()` with no options (fully permissive). Once auth is
added, CORS needs to be explicit — specifically `credentials: true` and a locked
`origin` — otherwise browsers will not send or receive the session cookie.

```ts
// replace: app.use('*', cors());
app.use('*', cors({
  origin: [process.env.FRONTEND_ORIGIN ?? "http://localhost:3000"],
  allowHeaders: ["Content-Type", "Authorization"],
  allowMethods: ["GET", "POST", "OPTIONS"],
  credentials: true,
}));
```

### 5. Add auth guard to `/api/openai/chat/completions`

Two lines at the top of the existing route handler:

```ts
app.post('/api/openai/chat/completions', async (c) => {
  // --- add these two lines ---
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  // --- existing code continues unchanged ---
  const body = await c.req.text();
  const upstream = await fetch(OPENAI_URL, { ... });
  return new Response(upstream.body, ...);
});
```

The `bearer()` plugin means this guard handles both cookie sessions (browser) and
Bearer token sessions (Word add-in or Python script) with the same single call.

### 6. Add env vars to `backend/.env`

```
BETTER_AUTH_SECRET=<generate with: openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:8000
GOOGLE_CLIENT_ID=<from Google Cloud Console>
GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
```

Add the same keys to `scripts/get_env.py` so they're populated in CI/Docker.

---

## What this does NOT change in PR #448

- JSONL logging (`logging.ts`) — untouched
- PostHog telemetry (`posthog.ts`) — untouched
- `LOG_SECRET`-gated viewer routes — untouched
- Docker / compose / nginx — untouched
- The `createApp()` factory pattern — auth just mounts inside it
- Existing tests — new auth tests would be added separately

---

## Auth0 migration path

Better Auth replaces Auth0, which currently lives in the frontend. The handoff:

1. Add Better Auth to the backend as described above (this playground proves it works).
2. Replace `@auth0/auth0-react` in the frontend with `better-auth/client`.
3. Remove Auth0 env vars and the Auth0 tenant config.

The device-code / JWT plugin work (for non-browser clients) is a separate milestone
and does not block the initial OAuth migration.
