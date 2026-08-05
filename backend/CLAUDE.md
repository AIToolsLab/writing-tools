TypeScript [Hono](https://hono.dev) server (Node) for the writing-tools add-in.

**Central concept**: LLM helps thinking and reflection instead of replacing writing.

Since the LLM prompting moved to the frontend (ai-sdk), this backend is intentionally
thin: it proxies OpenAI requests with the server-held API key and writes study logs.

`npm` package manager. Node 24.

## Aspects

- **Database** (`src/db.ts`): one SQLite file — `<DATA_DIR>/app.db` — on one shared
  connection, holding Better Auth's tables *and* ours. Better Auth manages its own
  schema (it introspects); our tables are versioned with `PRAGMA user_version` steps in
  `MIGRATIONS`. **To change our schema, append a step — never edit an existing one**
  (deployed DBs have already run it and will skip it forever). `src/migrate.ts` applies
  both schemas and is the deploy-time entrypoint (k8s initContainer). A pre-existing
  `auth.db` (the old name, when Better Auth was the only tenant) is renamed to `app.db`
  on first open, siblings included.
- **OpenAI proxy** (`src/openaiProxy.ts`): `POST /api/openai/chat/completions` and
  `/api/openai/responses` inject a server-held API key and relay the upstream response
  through unchanged (`stream:true` piped as SSE, everything else buffered). The
  frontend's ai-sdk client builds the prompts and points at this route, sending the
  session token as its bearer. `attributeRequest` decides **which key pays**, and the
  usage bucket always names the key that was charged so the summary reconciles against
  the right invoice: a session → `OPENAI_API_KEY`, metered to that user; no session →
  `OPENAI_DEMO_API_KEY` (the capped Thoughtful-demo project), metered to `demo` — this
  is how demo mode and the pre-sign-in editor work; no session and no demo key → 401 if
  auth is on (fail closed), else the main key metered to `anonymous` (local dev). An
  empty-bodied upstream 200 is rejected as a 502 (undici h2 transport failures on Node
  26 otherwise surface as silent empty 200s — see the comment in `openaiProxy.ts`; run
  Node 24 LTS).
- **Usage metering** (`src/usage.ts`, `src/pricing.ts`): every proxied model request
  writes a content-free row (user, `client_id`, model, token counts, status) to the
  `llm_usage` table. `client_id` attributes the request to the tool that made it (a
  registered tool's id, or null for the first-party add-in) — the billing/provenance
  counterpart of the same field on study logs. Streaming responses are `tee()`d so usage can be read from the
  terminal SSE event — which is also why the proxy forces `stream_options.include_usage`
  on Chat Completions requests. Metering sits *outside* the consent levels in
  `consent.ts`: it's billing data, kept even at level `none`. `GET /api/usage_summary`
  (gated by `LOG_SECRET`) breaks spend down by user; dollars are computed at read time
  from the hand-maintained rate table in `pricing.ts`, so **an unlisted model reports
  `cost: null` until you add its rates**. Account deletion anonymizes these rows rather
  than dropping them (see `anonymizeUserUsage`).
- **Logging** (`src/logging.ts`): structured JSONL to `backend/logs/<username>.jsonl`,
  same shape/location the Python backend used. `validateUsername` is the
  path-traversal guard. Log-viewer endpoints (`/api/logs_poll`, `/api/download_logs`)
  are gated by `LOG_SECRET`.
- **Frontend serving** (`src/static.ts`): in the production single-container image
  the backend also serves the built frontend (`frontend/dist`, copied to `./public`
  by the repo-root `Dockerfile`). `serveFrontend` registers a catch-all GET *after*
  every `/api/*` route so the API always wins; it's a no-op in local dev, where the
  static root doesn't exist. Cache rules: `no-store` for `.html`/`manifest.xml`
  (they reference content-hashed bundles by name), `immutable` for hashed assets.
- **Telemetry** (`src/posthog.ts`): optional PostHog error capture; a no-op when
  `POSTHOG_PROJECT_TOKEN` is unset. `deletePosthogPerson` (used by both erasure
  paths) hits the PostHog *management* API and needs `POSTHOG_PERSONAL_API_KEY` +
  `POSTHOG_PROJECT_ID`; without them it warns and no-ops.
- **Tool launcher** (`src/toolGrants.ts`): the handoff grant flow for launching
  external writing tools from the sidebar (see `docs/tool-launcher-plan.md`, Phase 1).
  The signed-in taskpane mints a single-use, short-TTL grant (`POST /api/handoff`)
  carrying the user, the tool's `client_id`, requested scopes, and an optional
  read-only document snapshot; the tool — on its own foreign origin — swaps the
  grant_id for a `wtk_`-prefixed bearer token (`POST /api/handoff/exchange`). That
  token is our own credential (a `tool_grant` row, not a Better Auth session):
  `app.ts` `resolveUser` recognizes the `wtk_` prefix and resolves it here, so the
  tool's proxy/log calls run under the user's account, attributed to the tool.
  `GET /api/handoff/doc` re-fetches the snapshot (gated by `doc:read`);
  `POST /api/handoff/revoke` disconnects a token. Scope enforcement beyond the doc
  re-fetch is deferred (Phase 3).
- **Auth** (`src/auth.ts`): Better Auth (Google sign-in + device-code flow for the
  add-in), on the shared `app.db`, enabled by `BETTER_AUTH_ENABLED=true`. Carries the
  user's `loggingConsent` level as a user field; `beforeDelete` purges study logs and
  anonymizes usage rows. The fixed public Mindmap OAuth client is provisioned through
  Better Auth's adapter at startup (`oauth-clients.ts`); app migration v7 performs the
  one-time cleanup of clients created while dynamic registration was enabled.

## Commands

- `npm run dev` — watch-mode server (`tsx`). Defaults to port 8000 to match the
  webpack dev-server proxy; Docker sets `PORT=5000`.
- `npm test` — Vitest unit tests (`src/**/*.test.ts`).
- `npm run build` — `tsc` → `dist/`. `npm start` runs the built server.

## Env vars

`OPENAI_API_KEY` (required to proxy), `OPENAI_DEMO_API_KEY` (Thoughtful-demo project;
pays for sessionless requests — without it they're refused wherever auth is on),
`LOG_SECRET` (required for log-viewer + `/api/usage_summary`), `DATA_DIR` (root for
`app.db` + `logs/`), `PORT`, `DEBUG`, `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST`,
`POSTHOG_PERSONAL_API_KEY` + `POSTHOG_PROJECT_ID` (management API — needed for
"delete my data" to purge a user's PostHog person; unset => that step no-ops), `LOG_DIR`
(overrides just the logs subdir). Auth: `BETTER_AUTH_ENABLED`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, `MINDMAP_OAUTH_CLIENT_ID`, and
`MINDMAP_OAUTH_REDIRECT_URIS` (comma-separated exact callback URLs). For local
dev, run `python scripts/get_env.py` to generate
`backend/.env`; it prompts for `OPENAI_DEMO_API_KEY` too and defaults it to the main key,
since an unset demo key makes every demo/anonymous request 401 once auth is enabled.

## Analysis tooling

Python log-analysis scripts live in `scripts/` (root `pyproject.toml`). They read the
JSONL logs this server writes and are unaffected by the backend language.
