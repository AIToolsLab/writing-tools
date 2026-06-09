TypeScript [Hono](https://hono.dev) server (Node) for the writing-tools add-in.

**Central concept**: LLM helps thinking and reflection instead of replacing writing.

Since the LLM prompting moved to the frontend (ai-sdk), this backend is intentionally
thin: it proxies OpenAI requests with the server-held API key and writes study logs.

`npm` package manager. Node 24.

## Aspects

- **OpenAI proxy** (`src/app.ts`): `POST /api/openai/chat/completions` injects
  `OPENAI_API_KEY` and streams the upstream SSE response through unchanged. The
  frontend's ai-sdk client builds the prompts and points at this route.
- **Logging** (`src/logging.ts`): structured JSONL to `backend/logs/<username>.jsonl`,
  same shape/location the Python backend used. `validateUsername` is the
  path-traversal guard. Log-viewer endpoints (`/api/logs_poll`, `/api/download_logs`)
  are gated by `LOG_SECRET`.
- **Telemetry** (`src/posthog.ts`): optional PostHog error capture; a no-op when
  `POSTHOG_PROJECT_TOKEN` is unset.
- **Auth**: none in the backend (unchanged from before). Auth0 still lives in the
  frontend. Replacing it (Better-Auth device-code) is deferred — see
  `docs/js-backend-plan.md`.

## Commands

- `npm run dev` — watch-mode server (`tsx`). Defaults to port 8000 to match the
  webpack dev-server proxy; Docker sets `PORT=5000`.
- `npm test` — Vitest unit tests (`src/**/*.test.ts`).
- `npm run build` — `tsc` → `dist/`. `npm start` runs the built server.

## Env vars

`OPENAI_API_KEY` (required to proxy), `LOG_SECRET` (required for log-viewer routes),
`PORT`, `DEBUG`, `POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST`, `LOG_DIR` (defaults to
`./logs`). For local dev, run `python scripts/get_env.py` to generate `backend/.env`.

## Analysis tooling

Python log-analysis scripts live in `scripts/` (root `pyproject.toml`). They read the
JSONL logs this server writes and are unaffected by the backend language.
