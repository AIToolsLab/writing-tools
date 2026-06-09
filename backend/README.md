# writing-tools backend

TypeScript [Hono](https://hono.dev) server (Node 24). Thin OpenAI proxy + JSONL study
logging for the writing-tools add-in. The LLM prompting lives in the frontend (ai-sdk);
this server just injects the API key and streams responses, and records study logs.

## Develop

```bash
npm install
python ../scripts/get_env.py   # creates backend/.env (OPENAI_API_KEY, LOG_SECRET, ...)
npm run dev                    # http://localhost:8000  (matches the webpack dev proxy)
```

`npm test` runs the Vitest suite; `npm run build` compiles to `dist/`.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | `/api/openai/chat/completions` | OpenAI-compatible passthrough; streams SSE. |
| POST | `/api/log` | Append a client event to `logs/<username>.jsonl`. |
| GET  | `/api/ping` | `{ timestamp }`. |
| POST | `/api/logs_poll` | `LOG_SECRET`-gated; new log entries since the client's position. |
| GET  | `/api/download_logs?secret=…` | `LOG_SECRET`-gated; ZIP of all log files. |

## Deploy

Built and run via Docker (`Dockerfile`) and `docker-compose*.yml` at the repo root,
driven by `Jenkinsfile`. The container WORKDIR is `/app/backend`, so logs land in
`/app/backend/logs` — the path the study-log volume is mounted to. Listens on `5000`
in all Docker contexts (`PORT=5000`).

## Environment variables

`OPENAI_API_KEY`, `LOG_SECRET`, `PORT` (default 8000), `DEBUG`,
`POSTHOG_PROJECT_TOKEN`, `POSTHOG_HOST`, `LOG_DIR` (default `./logs`).
