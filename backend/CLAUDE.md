Python FastAPI server for LLM calls and logging for a writing tools application.

**Central concept**: LLM helps thinking and reflection instead of replacing writing.

Use `uv` - NOT pip. `uv run <command>`

Aspects:

- OpenAI API (`nlp.py`) + FastAPI with SSE (`server.py`)
- **Logging**: Structured logs to `/backend/logs/`
- **Auth**: Auth0 JWT tokens (work in progress)

