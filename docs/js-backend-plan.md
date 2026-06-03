# JS Backend Plan (under evaluation)

An alternative to `docs/auth-plan.md`. Same problem (replace Auth0, gain a user store, host the AI proxy), different shape: replace the production backend with a small **Hono** (TypeScript) service that uses **Better-Auth** instead of building auth from primitives.

This plan is **under evaluation alongside** `docs/auth-plan.md`. Stage 0 (proof of concept) is the gate: if it works, we commit to this plan and shelve `auth-plan.md`; if it doesn't, we fall back to the FastAPI route.

## Why consider this

- The LLM endpoints are migrating to ai-sdk in a separate PR, shrinking the Python backend to "proxy + auth + log writes."
- Better-Auth handles ~80% of `auth-plan.md`'s scope (sessions, OAuth handlers, account management, deletion, export) as a library, instead of as code we maintain.
- ai-sdk on the server side eliminates the proxy layer entirely — the Hono route handler *is* the model call.
- A single language across frontend and the slimmed backend lets `ModelMessage` and similar types be shared (eventually).

## Why Hono, not Next.js, for the backend

The backend has **no UI** beyond one throwaway OAuth landing page ("signing you in… you can close this tab"). That removes the reason to reach for a UI/SSR framework:

- **App Router's premise is inert here.** RSC/App Router exists to server-render initial content and stream server data into the first paint. This service renders no app UI, and the add-in itself boots inside Word/GDocs where there is no server-rendered first paint to optimize. We'd adopt Next's whole conceptual surface (RSC, the server/client boundary, Turbopack, the build model) to use ~none of it.
- **Hono is "FastAPI, in TypeScript."** A minimal router + middleware, no bundler, no SSR build step. Prod-path shape stays nearly identical to today (one service serving the add-in's API + a couple of static assets), just TS instead of Python.
- **Better-Auth and ai-sdk are both first-class on Hono.** Better-Auth mounts as a single catch-all handler; ai-sdk's `streamText(...).toUIMessageStreamResponse()` returns a standard `Response` that Hono returns directly.
- **Runtime-portable.** The same code runs on Node, Bun, or Deno, so hosting isn't pinned to a Next-shaped deploy target.

**Next.js stays the fallback:** if Stage 0 surfaces a Better-Auth/device-code gap that Hono makes hard but Next's ecosystem makes easy, we swap the backend framework without changing the plan's shape.

### A note on "single origin"

Splitting the SPA frontend from this backend does **not** force two web origins. The Office manifest already pins fixed URLs and we already front things with nginx, so the built SPA and the Hono service can sit behind one origin (Hono can even serve the static bundle itself; in dev, Vite's `server.proxy` forwards `/api` and `/auth` to Hono). There is no CORS tax inherent to the split — and `/api/*` uses bearer tokens, not cookies, so cross-site cookie rules don't apply even if we did split origins.

## Non-coupling decisions

- **Not** sharing code with `experiment/` right now. New sibling app. Re-evaluate sharing later, after both stabilize.
- **Keep JSONL** for logs — same format and location as today. Python analysis code reads JSONL unchanged.
- **Python backend stays alive** during transition. The new JS backend serves the production add-in only; FastAPI keeps serving any endpoints not yet migrated and remains the home of analysis tooling.

## Target Architecture (post-POC)

```
frontend/         # unchanged: TS/React Office add-in + GDocs sidebar + standalone
backend-ts/     # new: Hono service (Node/Bun); serves add-in API + auth
  - Better-Auth (Google OAuth, SQLite via Drizzle)
  - Device-code login shell (sidebar can't iframe Google)
  - /api/openai/chat/completions (ai-sdk passthrough)
  - /api/get_suggestion, /api/reflections (ported once LLM-endpoints PR lands)
  - /api/log → appends to logs/*.jsonl, same path as today
backend/          # Python: kept for analysis scripts, log viewer, anything not migrated
logs/             # JSONL files, shared between Python and JS backends via the persistent volume
```

The JS backend and Python backend share **only the log files on disk** (JSONL) and **possibly** the SQLite file (read-only from Python for analysis). No shared code, no shared deploy.

## Stage 0 — Proof of Concept

**Goal:** answer "will this actually work in Word and GDocs sidebars, and is Better-Auth flexible enough for the device-code wrapper?" *before* committing to a full migration.

**Out of scope for Stage 0:** porting any existing endpoints, frontend changes to the real add-in, deletion/export, study cohort, dev/prod deploy story. Just enough to learn.

### Scope

Create a sibling app at `backend-ts/`:

- Hono app (Node or Bun runtime) — route handlers only; the *only* rendered HTML is the OAuth landing / "close this tab" page (`c.html(...)` or a static file).
- Better-Auth configured with:
  - Google provider
  - Drizzle adapter
  - SQLite (file in `backend-ts/.data/poc.db`, gitignored)
  - Mounted on Hono as a catch-all handler: `app.on(['POST','GET'], '/api/auth/**', (c) => auth.handler(c.req.raw))`.
- Device-code wrapper, ~3 endpoints:
  - `POST /auth/device/start` — create `pending_logins` row, return `{ device_code, login_url }`
  - `GET /auth/login?device_code=…` — render a tiny page that calls Better-Auth's `signIn.social({ provider: 'google', callbackURL: '/auth/device/complete?device_code=…' })`
  - `GET /auth/device/complete?device_code=…` — after Better-Auth's callback runs and a session cookie exists, link the session to the `device_code` and show "you can close this tab"
  - `GET /auth/device/poll?device_code=…` — sidebar polls; returns the Better-Auth session token once linked
- One protected LLM endpoint: `POST /api/openai/chat/completions`
  - Reads `Authorization: Bearer <session_token>`, validates with Better-Auth
  - Calls `streamText({ model: openai('gpt-4o'), messages })` and returns the result with `toUIMessageStreamResponse()` *or* a raw OpenAI-compatible SSE stream (try the AI SDK protocol first since the frontend was already migrated to ai-sdk in PR #433)
- JSONL log write on each `/api/openai/*` call. Same `Log` shape as `backend/server.py`, written to `logs/poc.jsonl`.
- **Tiny test harness**, not the real add-in: a single static HTML file in `backend-ts/poc-client/` that runs the device-code flow, stores the token in `localStorage`, and calls the protected streaming endpoint. We hit this URL from inside Word's task pane and GDocs sidebar manually.

### What we are explicitly validating

1. We can open the `login_url` as a new tab in the user's main browser, even when the add-in is loaded inside of the Word desktop app. In the GDocs sidebar, we can either open a new tab or pop up a dialog.
2. Polling completes within a few seconds of Google consent — no weird state where the browser tab finishes but the sidebar never sees the session.
3. Better-Auth's session cookie is accessible from a Hono handler (`/auth/device/complete`) that runs in the *same* request chain as its callback, so we can stamp the `device_code → session` link without forking Better-Auth's internals.
4. The streaming response works end-to-end: `streamText` server-side → SSE → ai-sdk client-side, with `Authorization` header preserved across the streaming fetch.
5. JSONL append survives concurrent writes (a Python `fsspec`-style append, or `fs.appendFile` in Node — either should be fine but worth proving once).
6. The whole thing runs locally with `bun dev` (or `tsx watch`) — no bundler/SSR build step at all.

### Exit criteria

Stage 0 passes if **all six** of the above work in a 30-minute manual test session covering Word, GDocs, and the standalone surface.

Stage 0 fails (and we fall back to `auth-plan.md`) if any of:
- Better-Auth's session-cookie / device-code linkage requires forking the library or unsupported APIs.
- `window.open` is consistently blocked in Word or GDocs and there's no clean fallback.
- The deploy story for the Hono service on the existing infra is materially worse than redeploying FastAPI (e.g., requires moving off the current host).

### Stage 0 deliverables

- `backend-ts/` directory committed to a branch, runnable with one command.
- `backend-ts/README.md` with manual test steps.
- A short writeup in this doc (appended below as "Stage 0 results") documenting what worked, what didn't, and the go/no-go decision.

## Stage 1+ (sketch only; revisit after Stage 0)

Only fill this in once Stage 0 passes.

- **Stage 1:** Port the AI-SDK-migrated chat/revise endpoints from `backend/server.py` to `backend-ts/`. Frontend points at the new host for `/api/openai/*`. FastAPI stops serving those routes.
- **Stage 2:** Wire the real frontend `useSession()` to Better-Auth via the device-code shell. Remove `@auth0/auth0-react`.
- **Stage 3:** Port `/api/get_suggestion` and `/api/reflections` after the separate ai-sdk migration PR lands.
- **Stage 4:** Account deletion + export endpoints (Better-Auth has primitives for these; thin wrappers).
- **Stage 5:** Study cohort flag — same options as `auth-plan.md` (manual DB flag for MVP).
- **Stage 6:** Decide whether to retire FastAPI or keep it for analysis-only.

## Tradeoffs vs. `auth-plan.md`

| Axis | This plan (JS backend) | `auth-plan.md` (FastAPI + roll auth) |
|---|---|---|
| New code we maintain | ~Device-code shell only | Full schema, sessions, OAuth handlers, deletion, export |
| Languages in the prod path | TS only | TS + Python |
| Ecosystem fit with ai-sdk | Native (streamText server-side) | Proxy bytes |
| Risk of vendor/library churn | Better-Auth is young (~v1) | Authlib is mature; we own the schema |
| Time to first auth working | Lower if POC passes | Higher; more bespoke code |
| Time to first auth working if POC fails | Much higher (sunk POC) | Same as planned |
| Migration cost from current state | Larger surface (replace whole backend) | Smaller surface (add auth to existing) |
| Analysis pipeline impact | None (JSONL preserved) | None |
| Deploy surface | New service to host | Existing FastAPI |

## Open Questions

- **Hosting:** where does the Hono service run in production? Same host as FastAPI, sidecar, or separate? Affects Stage 0's "deploy story" exit criterion.
- **Runtime:** Node, Bun, or Deno? Default to Node for boring-tech reasons unless Bun's DX wins materially in Stage 0 (Hono runs on all three unchanged).
- **Drizzle vs Prisma:** Better-Auth supports both. Lean Drizzle (lighter, less codegen) unless the POC reveals an issue.
- **SSE vs AI SDK data-stream protocol on the wire:** the frontend was migrated to ai-sdk's client in PR #433 and consumes either format. Pick whichever Better-Auth + Hono make easier in Stage 0.

## Stage 0 Results

*(To be filled in after the POC. Outcome here is the go/no-go signal for the rest of this plan.)*
