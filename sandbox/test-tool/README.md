# Platform API v0 — test tool

A throwaway external "writing tool" for exercising the Phase 1 handoff grant flow
end-to-end (`docs/tool-launcher-plan.md`). It runs on its own origin, exchanges the
launch grant from the URL fragment, and fires each Platform API v0 call.

**Dev only — not for merge.** It's wired into two places you'll want to revert:

- `frontend/src/pages/tools/index.tsx` — a `test-tool` entry in `FIRST_PARTY_TOOLS`.
- `backend/.env` — `test-tool` in `BETTER_AUTH_DEVICE_CLIENT_IDS`.

## Run it

1. **Backend** (`backend/`): `npm run dev` (port 8000). It needs a full env for the
   LLM call to actually work — `OPENAI_API_KEY` (or `OPENAI_DEMO_API_KEY`) and the
   Better Auth vars. Run `python scripts/get_env.py` if your `.env` is bare, then
   re-add the `BETTER_AUTH_DEVICE_CLIENT_IDS` line if get_env overwrites it.

2. **Serve this tool** on its own origin (any port other than the backend's):

   ```
   cd sandbox/test-tool && python3 -m http.server 4000
   ```

   The `url` in `FIRST_PARTY_TOOLS` points at `http://localhost:4000/`.

3. **Sidebar**: open the standalone editor (`frontend/`: `npm run dev-server`,
   then `https://localhost:3000/editor.html`) or the Word taskpane, sign in, go to
   the **Tools** page, and click **Launch** on "Platform API test tool".

The tool opens in your browser at `http://localhost:4000/#wt_grant=<id>`, auto-exchanges
the grant, and shows the token + doc snapshot. The buttons then hit the LLM proxy,
`/api/log`, `/api/handoff/doc`, and `/api/handoff/revoke` with the `wtk_` token.

If the tool's API-base field (defaulting to `http://localhost:8000`) doesn't match
where your backend runs, edit it and re-exchange.

## What each button proves

| Button | Endpoint | Proves |
| --- | --- | --- |
| (auto) Exchange | `POST /api/handoff/exchange` | grant → `wtk_` token + doc snapshot |
| Call LLM proxy | `POST /api/openai/chat/completions` | token authorizes metered LLM access, attributed to `test-tool` |
| Write a log line | `POST /api/log` | JSONL log keyed to `(user, test-tool)` |
| Re-fetch document | `GET /api/handoff/doc` | `doc:read`-gated snapshot re-fetch |
| Revoke token | `POST /api/handoff/revoke` | teardown — subsequent calls 401 |
