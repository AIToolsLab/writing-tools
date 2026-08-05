# writing-tools backend

TypeScript [Hono](https://hono.dev) server (Node 24). Thin OpenAI proxy + JSONL study
logging for the writing-tools add-in. The LLM prompting lives in the frontend (ai-sdk);
this server just injects the API key and streams responses, and records study logs.

## Develop

```bash
npm install
python ../scripts/get_env.py   # creates backend/.env (OPENAI_API_KEY, LOG_SECRET, ...)
npm run dev                    # http://localhost:8000  (matches the Vite dev-server proxy)
```

`npm test` runs the Vitest suite; `npm run build` compiles to `dist/`.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/api/openai/chat/completions` | OpenAI-compatible passthrough; streams SSE. |
| POST | `/api/openai/responses` | OpenAI Responses passthrough; streams SSE. |
| POST | `/api/log` | Append a client event to `logs/<username>.jsonl`. |
| GET  | `/api/ping` | `{ timestamp }`. |
| POST | `/api/logs_poll` | `LOG_SECRET`-gated; new log entries since the client's position. |
| GET  | `/api/download_logs?secret=…` | `LOG_SECRET`-gated; ZIP of all log files. |
| GET  | `/api/usage_summary` | `LOG_SECRET`-gated; per-user LLM spend from the usage table. |

## Deploy

Production is a **single container** built from the repo-root `Dockerfile`: this
backend also serves the built frontend (copied to `./public`) alongside `/api/*` — see
[../docs/single-container-consolidation.md](../docs/single-container-consolidation.md).
`.github/workflows/build-addin-image.yml` builds that image and pushes it to GHCR on
push to `main`; deployment runs on k8s (CD in the `Infrastructure_k8s_*` repo pins the
image by SHA). The container WORKDIR is `/app/backend`, and all persistent state lives
under one mounted volume at `/app/backend/data` (`DATA_DIR`): `app.db` plus `logs/`.
Listens on `5000` in Docker (`PORT=5000`).

## Standalone Mindmap OAuth

The fixed public client uses `MINDMAP_OAUTH_CLIENT_ID` and
`MINDMAP_OAUTH_REDIRECT_URIS`. Development defaults to client id
`writing-tools-mindmap` and the sole callback `http://localhost:5181/`.
Production has no defaults and should register only
`https://mindmap.thoughtful-ai.com/`; do not register localhost on the live
authorization server. Access tokens use the canonical origin of
`BETTER_AUTH_URL` as their resource and audience.

The server never purges OAuth clients. If a local database contains clients
created during an abandoned OAuth experiment, stop the local backend and delete
that disposable `backend/data/app.db` rather than shipping cleanup SQL that could
remove future production clients.

## Environment variables

`OPENAI_API_KEY`, `OPENAI_DEMO_API_KEY` (pays for sessionless/demo requests; unset means
demo mode 401s once `BETTER_AUTH_ENABLED=true`, so `get_env.py` offers to reuse the main
key for it locally),
`LOG_SECRET` (gates the log-viewer endpoints + `/api/usage_summary`), `DATA_DIR` (root
for `app.db` + `logs/`), `PORT` (default 8000), `DEBUG`, `POSTHOG_PROJECT_TOKEN`,
`POSTHOG_HOST`, `LOG_DIR` (overrides just the logs subdir). Auth (Better Auth) adds
`BETTER_AUTH_ENABLED`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
and related vars — see [CLAUDE.md](CLAUDE.md) for the full list.
