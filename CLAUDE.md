# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a writing tools application consisting of two main components:

- **Frontend** (`/frontend`): TypeScript/React Microsoft Office Add-in that integrates with Word
- **Backend** (`/backend`): Python FastAPI server providing text processing and AI-powered writing assistance

## Package Managers

**CRITICAL**: Always use the correct package manager for each component:

### Frontend (`/frontend`)
- **Use `yarn`** - NOT npm
- Commands:
  - Install: `yarn` or `yarn install`
  - Dev server: `yarn run dev-server`
  - Build: `yarn build` (production) or `yarn build:dev` (development)
  - Lint: `yarn lint` or `yarn lint:fix`
  - Format: `yarn format` or `yarn style:fix` (lint + format)
  - Test: `yarn test`

### Backend (`/backend`)
- **Use `uv`** - NOT pip
- Commands:
  - Install: `uv sync` (in root directory)
  - Run server: `uv run python server.py` or `uv run uvicorn server:app --host localhost --port 8000 --reload`
  - Run tests: `uv run pytest`
  - Type check: `uv run mypy .`
  - Lint: `uv run ruff check`

## Common Development Tasks

### Setup
```bash
# Root level - setup Python environment
uv sync

# Frontend setup
cd frontend && yarn install
```

### Running Services
```bash
# Frontend development server (runs on port 3000)
cd frontend && yarn run dev-server

# Backend server with auto-reload
cd backend && uv run uvicorn server:app --host localhost --port 8000 --reload
```

### Testing and Linting
```bash
# Frontend
cd frontend && yarn lint:fix && yarn format

# Backend  
cd backend && uv run pytest && uv run ruff check
```

## Architecture Overview

### Frontend (Office Add-in)
- **React/TypeScript** application using Office.js APIs
- **State Management**: Jotai for global state
- **Styling**: Tailwind CSS with CSS modules
- **Authentication**: Auth0 integration
- **Build Tool**: Webpack with TypeScript
- **Key Entry Points**: 
  - `src/taskpane.html` - Main task pane interface
  - `src/editor/editor.tsx` - Document editor integration
  - `src/api/index.ts` - Backend API communication

### Backend (FastAPI)
- **Framework**: FastAPI with uvicorn server
- **AI Integration**: OpenAI API for text processing
- **NLP Processing**: spaCy for text analysis (`nlp.py`)
- **Authentication**: auth0 signed JWT tokens (work in progress)
- **Logging**: Structured logging to `/backend/logs/` directory
- **Key Files**:
  - `server.py` - Main FastAPI application
  - `nlp.py` - Text processing and AI generation logic

### Communication
- Frontend communicates with backend via REST API at `/api` endpoints
- Server-sent events (SSE) for streaming AI responses
- CORS configured for cross-origin requests during development

## Development Configuration

### TypeScript Configuration
- Strict mode enabled with path aliases (`@/*` maps to `./src/*`)
- React JSX transform configured
- ES2020 modules with es5 target for IE11 compatibility

### Python Configuration  
- **Type Checking**: MyPy with Pydantic plugin enabled
- **Linting**: Ruff with standard Python exclusions
- **Testing**: pytest framework
- **Environment**: Environment variables loaded from `.env` file

### Office Add-in Specific
- Manifest file: `frontend/manifest.xml` 
- Supports both desktop and web versions of Microsoft Word
- Development certificates managed by office-addin-dev-certs

## Coding Conventions

### Frontend
- Use function declarations for named components, arrow functions for unnamed
- TypeScript strict mode - always include proper types
- React components should not explicitly import React (configured in ESLint)
- Use `@/` prefix for internal imports (webpack alias)
- Prefer `const` over `let`, avoid `var`

### Backend
- Follow PEP 8 and use type hints for all functions
- Use snake_case for variables/functions, CamelCase for classes
- Async/await pattern for API endpoints
- Proper error handling with FastAPI exception handlers

## Testing

### Frontend Tests
- Jest testing framework configured
- Test files should be in `__tests__` directories or have `.test.ts` suffix

### Backend Tests  
- Use pytest with async test support
- Test files: `*_tests.py` or `test_*.py`
- Run specific tests: `uv run pytest backend/test_specific.py`