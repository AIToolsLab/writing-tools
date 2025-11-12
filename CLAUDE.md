# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Structure

Writing tools application:
- `/frontend`: TypeScript/React Microsoft Office Add-in for Word + standalone editor
- `/backend`: Python FastAPI server for LLM calls and logging

**Central concept**: LLM helps thinking and reflection instead of replacing writing.

## Package Managers

- **Frontend**: `npm` (standard commands in `package.json`)
- **Backend**: `uv` - NOT pip
  - Install: `uv sync` (run from root)
  - All commands: `uv run <command>`

## Key Architecture

### Frontend (Office Add-in)
- **Office.js APIs** - Microsoft Word integration
- **Build Tool**: Vite + TypeScript
- **State Management**: Jotai atoms (see `frontend/src/contexts/`)
- **Path Alias**: `@/*` maps to `./src/*` (Vite config)
- **Entry Points**:
  - `src/taskpane.html` - Word task pane
  - `src/editor/editor.html` - Standalone demo editor and user study
- **Manifest**: `frontend/manifest.xml` for Office Add-in configuration

### Backend
- OpenAI API (`nlp.py`) + FastAPI with SSE (`server.py`)
- **Logging**: Structured logs to `/backend/logs/`
- **Auth**: Auth0 JWT tokens (work in progress)

## Non-Obvious Configuration

- **TypeScript**: Path aliases enabled (`@/*` → `./src/*`)

## User Study Mode

The application includes a built-in user study system. See [STUDY.md](STUDY.md) for complete details on:
- Study flow and URL parameters
- Condition codes and configuration
- State management and logging
- Study-specific components

## Testing

Testing is not yet well configured. When editing code, suggest high-value tests to add but wait for approval.
