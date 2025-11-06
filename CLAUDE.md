# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Structure

Writing tools application with two components:
- **Frontend** (`/frontend`): TypeScript/React Microsoft Office Add-in for Word
- **Backend** (`/backend`): Python FastAPI server for text processing and AI assistance

## Package Managers

**CRITICAL**: Use the correct package manager:
- **Frontend**: `npm` (standard commands in `package.json`)
- **Backend**: `uv` - NOT pip
  - Install: `uv sync` (run from root)
  - All commands: `uv run <command>`

## Key Architecture

### Frontend (Office Add-in)
- **Office.js APIs** - Microsoft Word integration
- **State Management**: Jotai atoms (see `frontend/src/contexts/`)
- **Path Alias**: `@/*` maps to `./src/*` (webpack config)
- **Entry Points**:
  - `src/taskpane.html` - Word task pane
  - `src/editor/editor.html` - Standalone editor and user study
- **Manifest**: `frontend/manifest.xml` for Office Add-in configuration

### Backend
- **SSE (Server-Sent Events)** - Streaming AI responses to frontend
- **Logging**: Structured logs to `/backend/logs/`
- **Auth**: Auth0 JWT tokens (work in progress)

### Communication
- Frontend → Backend: REST API at `/api` endpoints
- Backend → Frontend: SSE for streaming

## Non-Obvious Configuration

- **TypeScript**: Path aliases enabled (`@/*` → `./src/*`)
- **Office Add-in**: Supports desktop + web Word, dev certs managed by `office-addin-dev-certs`
- **Python**: MyPy with Pydantic plugin enabled

## User Study Mode

The application includes a built-in user study system. See [STUDY.md](STUDY.md) for complete details on:
- Study flow and URL parameters
- Condition codes and configuration
- State management and logging
- Study-specific components

## Testing

Testing is not yet well configured. When editing code, suggest high-value tests to add but wait for approval.
