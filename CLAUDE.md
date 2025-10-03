# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Structure

This is a writing tools application consisting of two main components:

- **Frontend** (`/frontend`): TypeScript/React Microsoft Office Add-in that integrates with Word
- **Backend** (`/backend`): Python FastAPI server providing text processing and AI-powered writing assistance

## Package Managers

**CRITICAL**: Always use the correct package manager for each component:

### Frontend (`/frontend`)
- Commands:
  - Install: `npm install`
  - Dev server: `npm run dev-server`
  - Build: `npm run build` (production) or `npm run build:dev` (development)
  - Lint: `npm run lint` or `npm run lint:fix`
  - Format: `npm run format` or `npm run style:fix` (lint + format)
  - Test: `npm run test`

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
cd frontend && npm install
```

### Running Services
```bash
# Frontend development server (runs on port 3000)
cd frontend && npm run dev-server

# Backend server with auto-reload
cd backend && uv run uvicorn server:app --host localhost --port 8000 --reload
```

### Testing and Linting
```bash
# Frontend
cd frontend && npm run lint:fix && npm run format

# Backend  
cd backend && uv run pytest && uv run ruff check
```

## Architecture Overview

### Frontend (Office Add-in)
- **React/TypeScript** application using Office.js APIs
- **State Management**: Jotai for global state
- **Styling**: a mix of Tailwind CSS and CSS modules
- **Authentication**: Auth0 integration
- **Build Tool**: Webpack with TypeScript
- **Key Entry Points**: 
  - `src/taskpane.html` - Main task pane interface for MS Word
  - `src/editor/editor.html` - Standalone editor for demo and user study
  - `src/editor/editor.tsx` - Document editor integration
  - `src/api/index.ts` - Backend API communication

### Backend (FastAPI)
- **Framework**: FastAPI with uvicorn server
- **AI Integration**: OpenAI API for text processing
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
- ES2020 modules with es5 target for IE11 compatibility (but IE is not tested so it's likely to not work)

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

## User Study Mode

The application includes a built-in user study system for conducting writing research experiments.

### Study Flow

The study follows a linear progression through pages controlled by [studyRouter.tsx](frontend/src/editor/studyRouter.tsx):

1. **study-consentForm** - Redirects to external Qualtrics consent form
2. **study-intro** - Welcome page with study overview and instructions
3. **study-introSurvey** - Demographic and AI familiarity questions
4. **study-startTask** - Pre-task instructions
5. **study-task** - Main writing task with AI assistance
6. **study-postTask** - Post-task survey (TLX, experience questions)
7. **study-final** - Completion page with optional Prolific code

### Accessing Study Mode

Study pages are accessed via URL parameters:
```
/editor.html?page=study-intro&username=USER_ID&condition=CONDITION_CODE
```

Required parameters:
- `username` - Unique participant identifier
- `condition` - Condition code mapping to different AI assistance modes:
  - `g` → example_sentences (3 example next sentences)
  - `a` → analysis_readerPerspective (3 reader reactions)
  - `p` → proposal_advice (3 pieces of directive advice)
  - `n` → no_ai (no AI assistance, static message only)
  - `f` → complete_document (AI generates full completed document)

Optional parameters:
- `isProlific=true` - Shows completion code on final page
- `contextToUse=true|false|mixed` - Controls which context the AI uses (not applicable for no_ai)
- `autoRefreshInterval=10000` - Interval (ms) for auto-refreshing AI suggestions (disabled for no_ai and complete_document)

### Study Configuration

Key configuration in [studyRouter.tsx](frontend/src/editor/studyRouter.tsx):
- `wave` - Study wave identifier (currently "wave-2")
- `completionCode` - Prolific completion code
- `letterToCondition` - Maps condition codes to condition names
- Task content in `summarizeMeetingNotesTask` and `summarizeMeetingNotesTaskFalse`

### Study State Management

Study-specific state is managed via Jotai atoms:
- `overallModeAtom` ([pageContext.tsx](frontend/src/contexts/pageContext.tsx)) - Set to `OverallMode.study` during studies
- `studyDataAtom` ([studyContext.tsx](frontend/src/contexts/studyContext.tsx)) - Stores:
  - `condition` - Current condition name
  - `trueContext` - Correct task context
  - `falseContext` - Intentionally incorrect context (for mixed conditions)
  - `autoRefreshInterval` - Refresh interval for AI suggestions
  - `contextToUse` - Which context to provide to AI

### Logging

All study interactions are logged to the backend via `log()` function in [api/index.ts](frontend/src/api/index.ts):

Key logged events:
- `view:{pageName}` - Page views (logged on every page)
- `Started Study` - Study initiation with browser metadata
- `taskStart` / `taskComplete` - Task boundaries
- `Document Update` - Document state changes during study mode (logged in [editor/index.tsx](frontend/src/editor/index.tsx:105-111))
- `surveyComplete:{surveyName}` - Survey submissions with responses

Browser metadata captured:
- User agent, screen/window dimensions, color depth
- Timezone, language preferences, platform
- Cookie/online status

### Study Components

- **EditorScreen** ([editor/index.tsx](frontend/src/editor/index.tsx)) - Main editor with word count display in study mode
- **StudyRouter** ([editor/studyRouter.tsx](frontend/src/editor/studyRouter.tsx)) - Manages study page routing and state
- **Survey** ([surveyViews.tsx](frontend/src/surveyViews.tsx)) - Reusable survey component
- **SurveyData** ([surveyData.tsx](frontend/src/surveyData.tsx)) - Pre-defined survey questions

### Document Storage

Documents are stored in localStorage with task-specific keys:
- Study tasks: `doc-{taskID}`
- Regular editor: `doc`

## Testing

Testing is not yet well configured in this repo. When editing code, suggest high-value tests to add but wait for approval.
