# voice-agent

The LiveKit worker behind the **My Words → Voice** tab. It runs an OpenAI
Realtime model and forwards its five editor tools (`view`, `str_replace`,
`insert`, `move`, `highlight`) to the browser over RPC, so the real document and
the word-bank rule stay in the frontend. See the plan in
`docs/my-words-voice-native-research.md` and
[`agent.py`](agent.py) for the design.

Standalone Python service (`uv`), a peer of `frontend/` and `backend/`. Not part
of either npm workspace.

## Setup

```sh
cd voice-agent
uv sync
```

## Credentials

The agent reads `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, and
`OPENAI_API_KEY`. It loads `voice-agent/.env.local` first (local overrides),
then falls back to `../backend/.env` — so once the backend has LiveKit creds
(via `python scripts/get_env.py`), the agent needs no extra config.

Optional overrides: `OPENAI_REALTIME_MODEL` (default `gpt-realtime-2`),
`OPENAI_REALTIME_VOICE` (default `marin`).

## Run

```sh
uv run python agent.py dev     # dev mode: registers with LiveKit Cloud
uv run python agent.py console # talk to it in the terminal (no browser tools)
lk agent dev                   # same as `dev`, plus hot-reload (in-process reload
                               # was removed from the Python CLI)
```

The worker registers **without an agent name**, so LiveKit auto-dispatches it to
any room the browser opens — no explicit dispatch needed.
