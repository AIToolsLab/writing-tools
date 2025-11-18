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
- **Entry Points** (at root level, not in src/):
  - `index.html` - Root entry point served at `/`
  - `taskpane.html` - Word task pane
  - `editor.html` - Standalone demo editor and user study
  - `logs.html` - Logging viewer
  - `popup.html` - Add-in popup
  - `commands.html` - Ribbon commands
- **Manifest**: `frontend/manifest.xml` for Office Add-in configuration

### Backend
- OpenAI API (`nlp.py`) + FastAPI with SSE (`server.py`)
- **Logging**: Structured logs to `/backend/logs/`
- **Auth**: Auth0 JWT tokens (work in progress)

## Non-Obvious Configuration

- **TypeScript**: Path aliases enabled (`@/*` → `./src/*`)
- **Vite Multi-Entry Setup**: The `vite.config.ts` uses `rollupOptions.input` to define multiple HTML entry points at the root level. Entry point files live at root, not in `src/`.
- **Root Entry Point**: `index.html` lives at the root level (not in `publicDir`). Vite automatically serves it at `/` without custom configuration.

## Debugging Approach

When encountering issues during development:

1. **Verify assumptions before "fixing"** - Don't accept initial problem statements at face value. Reproduce the issue yourself and understand the root cause.
2. **Start simple** - Try the simplest solution first (e.g., moving a file to the expected location) before adding complex code (middleware, plugins, etc).
3. **Test in isolation**, then test integration.
4. **Document why configurations exist** - Explain non-obvious setups (but avoid documenting the obvious).

## User Study Mode

The application includes a built-in user study system. See [STUDY.md](STUDY.md) for complete details on:
- Study flow and URL parameters
- Condition codes and configuration
- State management and logging
- Study-specific components

## Testing

Testing is not yet well configured. When editing code, suggest high-value tests to add but wait for approval.
