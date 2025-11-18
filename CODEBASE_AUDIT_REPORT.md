# Codebase Inconsistency Audit Report

**Date**: 2025-11-18
**Project**: Writing Tools (Thoughtful AI)
**Scope**: Comprehensive audit of frontend, backend, build, deployment, testing, and documentation

---

## Executive Summary

This audit identified **73 distinct issues** across 12 major system components. The codebase has significant functionality but suffers from:
- **Critical security gaps** (no backend JWT validation despite frontend Auth0 integration)
- **Broken user study features** (missing prompts, wrong context assignments)
- **Severely incomplete testing** (3% frontend coverage, 0% backend coverage)
- **Configuration conflicts** (Biome vs Prettier, webpack loader overlaps)
- **Documentation inaccuracies** (wrong paths, outdated instructions)

**Severity Breakdown**:
- 🔴 **Critical** (Will break functionality or create security vulnerabilities): 15 issues
- 🟡 **High Priority** (Important functionality, consistency, or maintainability): 24 issues
- 🟢 **Medium Priority** (Code quality, developer experience): 22 issues
- ⚪ **Low Priority** (Cleanup, optimization): 12 issues

---

## Critical Issues (🔴 Must Fix Immediately)

### Authentication & Security

#### 1. No Backend JWT Validation ⚠️ SECURITY
**Location**: `backend/server.py`, entire API surface
**Impact**: Anyone can call API endpoints without authentication
**Details**:
- Frontend sends `Authorization: Bearer ${token}` headers
- Backend completely ignores these headers (no validation middleware)
- All endpoints (`/api/get_suggestion`, `/api/chat`, `/api/log`, etc.) are publicly accessible
- OpenAI API costs can be exploited
- User data integrity compromised (username self-asserted)

**Fix Required**:
```python
# Add to pyproject.toml
dependencies = ["python-jose[cryptography]", ...]

# Add middleware to server.py
from fastapi import Security, HTTPException
from fastapi.security import HTTPBearer

security = HTTPBearer()

async def verify_token(credentials: HTTPAuthorizationCredentials = Security(security)):
    # Validate JWT from Auth0
    # Extract user email and verify Calvin.edu domain
    pass

# Apply to routes
@app.post("/api/get_suggestion", dependencies=[Depends(verify_token)])
```

**Files**: `backend/server.py`, `pyproject.toml`
**Priority**: 🔴 CRITICAL

---

#### 2. CORS Allows All Origins ⚠️ SECURITY
**Location**: `backend/server.py:32`
**Impact**: Any website can call your API

**Current**:
```python
origins = ["*"]
```

**Fix Required**:
```python
origins = [
    "https://localhost:3000",
    "https://app.thoughtful-ai.com",
]
```

**Files**: `backend/server.py:32`
**Priority**: 🔴 CRITICAL

---

### User Study Implementation

#### 3. Missing Prompt Definition: `analysis_describe`
**Location**: `backend/nlp.py`, `frontend/src/editor/studyRouter_withinSubjects.tsx:157`
**Impact**: Within-subjects study will crash when condition 'q' is selected

**Issue**:
- Within-subjects router maps condition 'q' → `analysis_describe`
- Backend only defines: `example_sentences`, `proposal_advice`, `analysis_readerPerspective`, `complete_document`
- `analysis_describe` doesn't exist

**Fix Required**: Add to `backend/nlp.py:53-97`:
```python
"analysis_describe": {
    "system": "...",
    "user": "..."
}
```

**Files**: `backend/nlp.py:53-97`, `frontend/src/editor/studyRouter_withinSubjects.tsx:157`
**Priority**: 🔴 CRITICAL (breaks study)

---

#### 4. Wrong Context Passed in Within-Subjects Study
**Location**: `frontend/src/editor/studyRouter_withinSubjects.tsx:433`
**Impact**: Experimental design broken - AI receives wrong context

**Current**:
```typescript
<EditorScreen taskID={taskID} contextData={falseContext} editorPreamble={editorPreamble} />
```

**Should be**:
```typescript
<EditorScreen taskID={taskID} contextData={trueContext} falseContextData={falseContext} editorPreamble={editorPreamble} />
```

**Files**: `frontend/src/editor/studyRouter_withinSubjects.tsx:433`
**Priority**: 🔴 CRITICAL (breaks study validity)

---

#### 5. `contextToUse` Parameter Not Implemented
**Location**: `STUDY.md:37`, backend API
**Impact**: Documented study feature completely non-functional

**Documented**: "contextToUse=true|false|mixed - Controls which context the AI uses"
**Reality**:
- Frontend validates and stores this parameter
- Backend never receives or uses it
- Backend always mixes contexts when `falseContextData` present

**Fix Required**: Implement in `backend/nlp.py` or remove from documentation

**Files**: `STUDY.md:37`, `backend/nlp.py:190`, `frontend/src/editor/studyRouter.tsx:232-249`
**Priority**: 🔴 CRITICAL (documented feature broken)

---

### API Contract Issues

#### 6. Missing `username` in Chat Regeneration
**Location**: `frontend/src/pages/chat/index.tsx:109-133`
**Impact**: Backend will reject request with 422 validation error

**Issue**: `regenMessage()` doesn't send required `username` parameter

**Current**:
```typescript
body: JSON.stringify({
    messages: chatMessages.slice(0, index),
    // Missing: username
}),
```

**Backend expects**:
```python
class ChatRequestPayload(BaseModel):
    messages: List[nlp.ChatCompletionMessageParam]
    username: ValidatedUsername  # Required!
```

**Files**: `frontend/src/pages/chat/index.tsx:109-133`, `backend/server.py:214`
**Priority**: 🔴 CRITICAL (broken feature)

---

#### 7. Wrong Response Type in Chat Regeneration
**Location**: `frontend/src/pages/chat/index.tsx:113-133`
**Impact**: Will fail at runtime - tries to parse SSE stream as JSON

**Issue**:
```typescript
const response = await fetch(`${SERVER_URL}/chat`, ...);
const responseJson = await response.json(); // Backend returns SSE, not JSON!
```

**Backend returns**: `EventSourceResponse` (SSE stream), not JSON

**Files**: `frontend/src/pages/chat/index.tsx:113-133`
**Priority**: 🔴 CRITICAL (broken feature)

---

### Configuration Issues

#### 8. Missing `baseUrl` in tsconfig.json
**Location**: `frontend/tsconfig.json`
**Impact**: TypeScript language server won't resolve `@/*` imports correctly

**Issue**: Path aliases require `baseUrl` to work:
```json
"paths": {
  "@/*": ["./src/*"]
}
// Missing: "baseUrl": "."
```

**Fix Required**: Add `"baseUrl": "."` to `compilerOptions`

**Files**: `frontend/tsconfig.json:18-21`
**Priority**: 🔴 HIGH (breaks IDE features)

---

#### 9. Webpack Loader Overlap
**Location**: `frontend/webpack.config.js:67-77`
**Impact**: Conflicting rules for `.ts` files

**Issue**: Two rules match `.ts` files:
```javascript
{ test: /\.ts$/, use: 'babel-loader' }      // Rule 1
{ test: /\.tsx?$/, use: ['ts-loader'] }      // Rule 2 (also matches .ts)
```

**Files**: `frontend/webpack.config.js:67-77`
**Priority**: 🔴 HIGH (build issues)

---

### Build & Deployment

#### 10. Backend Dockerfile Build Context Issue
**Location**: `backend/Dockerfile:9-10`
**Impact**: Docker build fails when run outside docker-compose

**Issue**:
```dockerfile
COPY ../pyproject.toml ../uv.lock ./
```
Cannot copy from parent directory in standalone build

**Workaround**: docker-compose sets `context: .` (root)
**Problem**: Developers following manual Docker build instructions will fail

**Files**: `backend/Dockerfile:9-10`
**Priority**: 🔴 HIGH

---

#### 11. Port Configuration Chaos
**Location**: Multiple files
**Impact**: Confusion about which port to use

| Component | Dev Local | Docker Dev | Docker Prod | Notes |
|-----------|-----------|------------|-------------|-------|
| Backend | 8000 | 5000 | 5000 (internal) | Inconsistent |
| Frontend | 3000 | 5001 | 19571 | Why 19571? |

**Files**: `backend/server.py:35`, `docker-compose-dev.yml`, `docker-compose-prod.yml`, `gunicorn.conf.py:3`, `webpack.config.js:11`
**Priority**: 🔴 HIGH (developer confusion)

---

### Environment Variables

#### 12. No .env.example Files
**Location**: `frontend/` and `backend/` directories
**Impact**: New developers don't know what variables are needed

**Missing Variables**:
- Backend: `DEBUG`, `PORT`, `AZURE_SPEECH_KEY`, `AZURE_REGION`, `SAS_TOKEN`
- Frontend: `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`

**Files**: Need to create `backend/.env.example` and `frontend/.env.example`
**Priority**: 🔴 HIGH

---

#### 13. Hardcoded Auth0 Credentials
**Location**: `frontend/webpack.config.js:161-162`
**Impact**: Credentials in source control, can't easily change per environment

**Current**:
```javascript
'process.env.AUTH0_DOMAIN': JSON.stringify('dev-rbroo1fvav24wamu.us.auth0.com'),
'process.env.AUTH0_CLIENT_ID': JSON.stringify('YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr')
```

**Should be**:
```javascript
'process.env.AUTH0_DOMAIN': JSON.stringify(process.env.AUTH0_DOMAIN),
'process.env.AUTH0_CLIENT_ID': JSON.stringify(process.env.AUTH0_CLIENT_ID)
```

**Files**: `frontend/webpack.config.js:161-162`
**Priority**: 🔴 HIGH

---

### Testing

#### 14. Missing `@jest/globals` Dependency
**Location**: `frontend/src/utilities/__tests__/selectionUtil.test.ts:1`
**Impact**: Tests won't run

**Used**: `import { describe, it, expect } from '@jest/globals';`
**Not in**: `package.json` devDependencies

**Fix**: `npm install --save-dev @jest/globals`

**Files**: `frontend/package.json`, `frontend/src/utilities/__tests__/selectionUtil.test.ts:1`
**Priority**: 🔴 HIGH

---

#### 15. Jest Wrong Test Environment
**Location**: `frontend/jest.config.js:2`
**Impact**: React component tests will fail

**Current**: `testEnvironment: 'node'`
**Should be**: `testEnvironment: 'jsdom'` (React needs DOM)

**Files**: `frontend/jest.config.js:2`
**Priority**: 🔴 HIGH

---

## High Priority Issues (🟡 Important)

### Dependencies

#### 16. 15+ Unused Dependencies
**Impact**: Bloated node_modules, confusion about what's needed

**Frontend Unused** (can remove):
1. `react-textarea-autosize` - Never imported
2. `@types/mocha` - Project uses Jest
3. `globals` - Not used in eslint.config.js
4. `@tailwindcss/cli` - Not in scripts
5. `acorn` - Webpack transitive dep
6. `file-loader` - Deprecated, using asset modules
7. `office-addin-test-helpers` - Not imported
8. `office-addin-test-server` - Not imported
9. `office-addin-mock` - Not imported
10. `source-map-loader` - Not in webpack config
11. `style-loader` - Using MiniCssExtractPlugin
12. `office-addin-prettier-config` - Not extending it
13. `@biomejs/biome` - Using ESLint/Prettier instead

**Backend Unused**:
1. `tenacity` - Never imported
2. `aiohttp` - Never imported

**Files**: `frontend/package.json`, `pyproject.toml`
**Priority**: 🟡 HIGH

---

#### 17. Biome vs Prettier Conflict
**Location**: `frontend/biome.json`, `frontend/.prettierrc`
**Impact**: Conflicting formatter configurations

**Issue**:
- Both Biome and Prettier installed
- Biome config: `quoteStyle: "double"`
- Prettier config: `singleQuote: true`
- Only Prettier used in scripts

**Fix**: Remove Biome completely

**Files**: `frontend/package.json:87`, `frontend/biome.json`
**Priority**: 🟡 HIGH

---

### Logging

#### 18. Missing `interaction` Field in Log Schema
**Location**: `backend/server.py:311-318`, `frontend/src/logs/index.tsx:9`
**Impact**: Log deduplication broken, UI shows undefined

**Issue**:
- Backend tries to deduplicate using `interaction` field
- Log model doesn't define `interaction`
- Always deduplicates with `None`

**Files**: `backend/server.py:121-126`, `backend/server.py:311-318`
**Priority**: 🟡 HIGH

---

#### 19. No Log Rotation
**Location**: `backend/server.py:360-362`
**Impact**: Log files grow unbounded, disk space risk

**Current**: Append-only mode, no size limits
**Need**: RotatingFileHandler or external rotation

**Files**: `backend/server.py:360-362`
**Priority**: 🟡 HIGH

---

#### 20. Document Update Over-Logging
**Location**: `frontend/src/editor/index.tsx:106-110`
**Impact**: Hundreds of log entries per session, full document content logged

**Issue**: Logs every document change with full document state, no debouncing

**Privacy Concern**: Full document content in logs

**Files**: `frontend/src/editor/index.tsx:106-110`
**Priority**: 🟡 HIGH (privacy + performance)

---

#### 21. Log Viewer Only Shows One Event Type
**Location**: `frontend/src/logs/index.tsx:97`
**Impact**: Most events invisible in viewer

**Issue**: Filters to only `suggestion_generated` events
**Missing**: Document Updates, surveys, task completions, etc.

**Files**: `frontend/src/logs/index.tsx:97`
**Priority**: 🟡 HIGH

---

### State Management

#### 22. Missing Jotai Provider
**Location**: `frontend/src/index.tsx`, `frontend/src/editor/index.tsx`
**Impact**: Using default store, issues with testing and isolation

**Fix**: Wrap app with `<Provider>` from `jotai`

**Files**: `frontend/src/index.tsx`, `frontend/src/editor/index.tsx`
**Priority**: 🟡 HIGH

---

#### 23. Inconsistent State Management Architecture
**Location**: Throughout frontend
**Impact**: Confusion about patterns

**Issue**:
- Some use Jotai atoms (`pageNameAtom`, `usernameAtom`)
- Some use React Context + useState (`ChatContext`)
- Should consolidate on one approach

**Files**: `frontend/src/contexts/chatContext.tsx`
**Priority**: 🟡 HIGH

---

#### 24. Misplaced Atom Definition
**Location**: `frontend/src/ControlledInput.tsx`
**Impact**: Hard to discover, breaks convention

**Issue**: `inputStateAtom` defined in component file, not `contexts/`

**Files**: `frontend/src/ControlledInput.tsx`
**Priority**: 🟡 MEDIUM

---

### Import Paths

#### 25. Inconsistent Import Patterns
**Location**: Throughout frontend
**Impact**: Code maintainability

**Issue**: Mixing `@/*` aliases and relative imports
**Count**: 52 alias imports, 25 relative imports

**Examples**:
- `frontend/src/index.tsx:2` - Uses relative `'./pages/app'` instead of `@/pages/app`
- `frontend/src/pages/app/index.tsx:18-21` - Uses `'../chat'` instead of `@/pages/chat`

**Files**: 11+ files with mixed patterns
**Priority**: 🟡 MEDIUM

---

### Documentation

#### 26. README.md Incorrect Commands
**Location**: `README.md:17`
**Impact**: Instructions don't work

**Issues**:
1. Documents: `npm run lint --fix` → Should be: `npm run lint:fix`
2. Documents: `add-in/manifest.xml` → Actual: `frontend/manifest.xml`
3. References non-existent: `./test_generation` script

**Files**: `README.md:6,17,28`
**Priority**: 🟡 HIGH

---

#### 27. STUDY.md References Wrong File
**Location**: `STUDY.md:42,46`
**Impact**: Developers look in wrong places

**Issues**:
1. Says config in `studyRouter.tsx` → Actually in `studyConfig.ts`
2. Says tasks are `summarizeMeetingNotesTask*` → Actually `prFixTask*`

**Files**: `STUDY.md:42,46`
**Priority**: 🟡 HIGH

---

#### 28. CLAUDE.md Auth Status Incorrect
**Location**: `CLAUDE.md:34`
**Impact**: Misleads about production readiness

**Says**: "Auth: Auth0 JWT tokens (work in progress)"
**Reality**: Auth0 fully implemented on frontend (just not validated on backend)

**Files**: `CLAUDE.md:34`
**Priority**: 🟡 MEDIUM

---

### Study Implementation

#### 29. Auto-Refresh Not Disabled for `complete_document`
**Location**: `frontend/src/pages/draft/index.tsx:270`
**Impact**: Study condition not implemented correctly

**STUDY.md says**: Disabled for `no_ai` and `complete_document`
**Code only checks**: `!isNoAI`

**Files**: `frontend/src/pages/draft/index.tsx:270`, `STUDY.md:38`
**Priority**: 🟡 HIGH

---

### Build & Deployment

#### 30. Conflicting Environment Variables in docker-compose-dev.yml
**Location**: `docker-compose-dev.yml`
**Impact**: Confusing configuration

**Issue**: Sets `DEBUG=True` (dev) and `NODE_ENV=production` simultaneously

**Files**: `docker-compose-dev.yml`
**Priority**: 🟡 MEDIUM

---

#### 31. Broken run.sh Script
**Location**: `run.sh`
**Impact**: Script doesn't work

**Issue**: References `add-in` directory which doesn't exist (should be `frontend`)

**Files**: `run.sh`
**Priority**: 🟡 MEDIUM

---

#### 32. No Health Checks in Docker
**Location**: Docker files
**Impact**: Can't tell if containers are healthy

**Missing**: Health check configuration in both Dockerfiles

**Files**: `backend/Dockerfile`, `frontend/Dockerfile`
**Priority**: 🟡 MEDIUM

---

### Testing

#### 33. No Backend Tests Whatsoever
**Location**: `backend/` directory
**Impact**: 0% backend code coverage

**Issue**:
- `pytest` in dependencies
- Zero test files exist
- 26+ functions untested

**Files**: `backend/` (missing tests/)
**Priority**: 🟡 HIGH

---

#### 34. Jest Missing Module Path Mapping
**Location**: `frontend/jest.config.js`
**Impact**: Tests will fail on imports using `@/*`

**Missing**:
```javascript
moduleNameMapper: {
  '^@/(.*)$': '<rootDir>/src/$1'
}
```

**Files**: `frontend/jest.config.js`
**Priority**: 🟡 HIGH

---

#### 35. Missing Testing Library Dependencies
**Location**: `frontend/package.json`
**Impact**: Can't write React component tests

**Missing**:
- `@testing-library/react`
- `@testing-library/jest-dom`
- `@testing-library/user-event`

**Files**: `frontend/package.json`
**Priority**: 🟡 HIGH

---

#### 36. No Test Coverage for Critical Features
**Location**: Throughout codebase
**Impact**: No confidence in refactoring

**Untested**:
- Office.js integration (wordEditorAPI.ts)
- All 6 state management contexts
- User study routing and logging
- Editor functionality
- All backend NLP functions
- All FastAPI endpoints

**Current Coverage**: ~3% frontend, 0% backend

**Priority**: 🟡 HIGH

---

## Medium Priority Issues (🟢 Maintenance)

### Configuration

#### 37. TypeScript Redundant Flags
**Location**: `frontend/tsconfig.json:28-30`
**Impact**: Cluttered config

**Issue**: `noImplicitAny` and `alwaysStrict` redundant with `strict: true`

**Files**: `frontend/tsconfig.json:28-30`
**Priority**: 🟢 MEDIUM

---

#### 38. isolatedModules Should Be True
**Location**: `frontend/tsconfig.json:25`
**Impact**: Webpack/Babel compatibility

**Current**: `false`
**Should be**: `true` for proper Babel compatibility

**Files**: `frontend/tsconfig.json:25`
**Priority**: 🟢 MEDIUM

---

#### 39. Prettier Not Checked in CI
**Location**: `.github/workflows/add-in.yml`
**Impact**: Unformatted code can be committed

**Issue**: CI runs `npm run lint` but not `npm run format:check`

**Files**: `.github/workflows/add-in.yml`
**Priority**: 🟢 MEDIUM

---

### API & Backend

#### 40. Unused Backend Endpoints
**Location**: `backend/server.py`
**Impact**: Dead code

**Unused**:
- `POST /api/reflections` - Never called from frontend
- `GET /api/ping` - Never called
- `GET /api/download_logs` - Likely manual use only

**Files**: `backend/server.py:193,280,334`
**Priority**: 🟢 MEDIUM

---

#### 41. Inconsistent Error Handling
**Location**: Frontend API calls
**Impact**: Poor user experience

**Issue**:
- `draft/index.tsx` - Checks `response.ok`, throws error
- `chat/index.tsx` - SSE errors only logged to console
- `logs/index.tsx` - Silent failure (empty catch)

**Files**: Multiple page components
**Priority**: 🟢 MEDIUM

---

#### 42. No Error Status Code Handling
**Location**: Frontend API calls
**Impact**: Can't distinguish 400/403/500 errors

**Issue**: Generic error handling, no status code checking

**Files**: Frontend API consumers
**Priority**: 🟢 MEDIUM

---

### Logging

#### 43. Inconsistent Log Schema
**Location**: `backend/server.py`
**Impact**: Difficult log analysis

**Issue**: Two different log types:
- `RequestLog` (typed with Pydantic)
- Generic `Log` (everything in `extra_data`)

**Files**: `backend/server.py:121-133`
**Priority**: 🟢 MEDIUM

---

#### 44. Timestamp Inconsistencies
**Location**: `backend/server.py`
**Impact**: Confusing analysis

**Issue**:
- Client logs: Frontend timestamp moved to `extra_data.client_timestamp`
- Backend logs: Server timestamp
- RequestLog: Server timestamp at end of request

**Files**: `backend/server.py:252,265`
**Priority**: 🟢 MEDIUM

---

#### 45. Inconsistent Event Naming
**Location**: Throughout logging calls
**Impact**: Hard to query logs

**Issue**: Mix of camelCase, spaces, snake_case
- "taskStart", "taskComplete"
- "Started Study", "Intro Survey"
- "suggestion_generated"

**Files**: Multiple
**Priority**: 🟢 MEDIUM

---

#### 46. No Error Handling for Log File Operations
**Location**: `backend/server.py:360-362`
**Impact**: Server crash on disk full

**Issue**: No try/except around file writes

**Files**: `backend/server.py:360-362`
**Priority**: 🟢 MEDIUM

---

#### 47. Missing Logging for Important Events
**Location**: Throughout frontend
**Impact**: Incomplete study data

**Not logged**:
- Accepting/rejecting suggestions
- Copying suggestions
- Chat interactions (individual messages)
- Authentication events
- Most errors

**Files**: Various pages
**Priority**: 🟢 MEDIUM

---

### State Management

#### 48. State Using localStorage Instead of atomWithStorage
**Location**: `frontend/src/pages/app/index.tsx`
**Impact**: Reinventing the wheel

**Issue**: `hasCompletedOnboarding` manually syncs with localStorage

**Should use**: `atomWithStorage` from `jotai/utils`

**Files**: `frontend/src/pages/app/index.tsx`
**Priority**: 🟢 MEDIUM

---

#### 49. Unused Atoms/Contexts
**Location**: Various
**Impact**: Code bloat

**Unused**:
- `ReflectionResponses` TypeScript type defined but never used
- `reportAuthError()` function defined but never called
- `authErrorType` state exists but never populated

**Files**: `frontend/src/types.d.ts`, `frontend/src/contexts/authTokenContext.tsx`
**Priority**: 🟢 LOW

---

### Study Implementation

#### 50. Two Parallel Study Implementations
**Location**: `studyRouter.tsx` vs `studyRouter_withinSubjects.tsx`
**Impact**: Confusion, maintenance burden

**Issue**: Completely different:
- URL parameters
- Condition codes
- Survey approaches
- Task flows
- Only between-subjects documented

**Files**: `frontend/src/editor/studyRouter*.tsx`
**Priority**: 🟢 MEDIUM

---

#### 51. Inconsistent Survey Handling
**Location**: Study routers
**Impact**: Different data collection approaches

**Between-subjects**: Embedded React components
**Within-subjects**: External Qualtrics redirects

**Files**: `frontend/src/surveyViews.tsx`, `studyRouter_withinSubjects.tsx:26-31`
**Priority**: 🟢 MEDIUM

---

### Documentation

#### 52-69. Missing Documentation for 18 Major Features
**Impact**: Onboarding difficulty, unclear architecture

**Missing docs for**:
1. Docker deployment (3 compose files)
2. Jenkins CI/CD (complete Jenkinsfile)
3. Logs viewer (separate entry point)
4. Multiple page modes (Draft/Revise/Chat)
5. Scripts directory (9 utility scripts)
6. Sandbox directory (eval/, interactive-editor/)
7. Metaprompt files (3 AI mode configurations)
8. Consistency analysis tools
9. Development container
10. GitHub Actions workflows
11. Within-subjects study variant
12. Biome linter
13. Reshaped UI library
14. Backend README
15. Frontend README
16. All entry points (popup.html, logs.html, commands.html)
17. Specific Jotai atoms and purposes
18. Deployment procedures

**Priority**: 🟢 MEDIUM (varies by feature)

---

## Low Priority Issues (⚪ Cleanup)

### Dependencies

#### 70. Node Version Inconsistency
**Location**: Docker vs CI
**Impact**: Potential build differences

**Docker**: Node 24
**CI**: Node LTS (20.x)

**Files**: `frontend/Dockerfile`, `.github/workflows/*.yml`
**Priority**: ⚪ LOW

---

### Configuration

#### 71. TypeScript ES5 Target Seems Old
**Location**: `frontend/tsconfig.json:16`
**Impact**: Unclear why ES5 needed

**Issue**: Targets ES5 but uses ES2020 modules and ES2021 libs

**Files**: `frontend/tsconfig.json:16`
**Priority**: ⚪ LOW

---

#### 72. Temporarily Disabled ESLint Rules
**Location**: `frontend/eslint.config.js:125-129`
**Impact**: Relaxed standards

**Issue**: Multiple strict rules disabled with "Temporarily allow" comments

**Files**: `frontend/eslint.config.js:125-129`
**Priority**: ⚪ LOW

---

#### 73. Inconsistent Project Naming
**Location**: Multiple files
**Impact**: Minor confusion

**Names used**:
- "thoughtful-ai-app" (package.json)
- "writing-tools" (repo, pyproject.toml)
- "app.thoughtful-ai.com" (prod URL)

**Files**: `package.json:2`, `pyproject.toml:2`
**Priority**: ⚪ LOW

---

## Summary by Component

### Frontend Issues
- **Critical**: 8 issues (auth headers ignored, study bugs, config issues)
- **High**: 14 issues (deps, logging, state, imports)
- **Medium**: 13 issues (patterns, error handling)
- **Low**: 3 issues (naming, config)

### Backend Issues
- **Critical**: 4 issues (no JWT validation, CORS, missing prompt)
- **High**: 4 issues (logging, env vars)
- **Medium**: 6 issues (error handling, endpoints)
- **Low**: 0 issues

### Build/Deployment Issues
- **Critical**: 2 issues (Docker, ports)
- **High**: 3 issues (env vars, health checks)
- **Medium**: 3 issues (scripts, docker-compose)
- **Low**: 1 issue (node versions)

### Testing Issues
- **Critical**: 2 issues (deps, config)
- **High**: 4 issues (no backend tests, no React testing libs, no coverage)
- **Medium**: 0 issues
- **Low**: 0 issues

### Documentation Issues
- **Critical**: 0 issues
- **High**: 3 issues (wrong commands, wrong paths)
- **Medium**: 18 issues (missing docs)
- **Low**: 1 issue (naming)

---

## Recommended Action Plan

### Phase 1: Critical Security & Functionality (Week 1)
1. Implement backend JWT validation (#1)
2. Fix CORS policy (#2)
3. Add `analysis_describe` prompt or remove from study (#3)
4. Fix within-subjects context assignment (#4)
5. Fix or document `contextToUse` (#5)
6. Fix chat regeneration bugs (#6, #7)

### Phase 2: Configuration & Environment (Week 2)
7. Add `baseUrl` to tsconfig.json (#8)
8. Fix webpack loader overlap (#9)
9. Create .env.example files (#12)
10. Move Auth0 creds to env vars (#13)
11. Standardize backend port (#11)
12. Remove Biome or Prettier (#17)

### Phase 3: Testing Infrastructure (Week 3)
13. Add missing test dependencies (#14, #35)
14. Fix Jest configuration (#15, #34)
15. Create backend test structure (#33)
16. Add tests for critical paths (#36)

### Phase 4: Logging & Study Improvements (Week 4)
17. Fix log schema issues (#18)
18. Implement log rotation (#19)
19. Debounce document updates (#20)
20. Fix log viewer filter (#21)
21. Fix auto-refresh for complete_document (#29)

### Phase 5: Documentation & Cleanup (Week 5-6)
22. Fix README errors (#26)
23. Update STUDY.md (#27, #29)
24. Add missing documentation (#52-69)
25. Remove unused dependencies (#16)
26. Standardize import patterns (#25)
27. Clean up state management (#22-24)

---

## Files Requiring Most Attention

1. `backend/server.py` - 12 issues (auth, CORS, logging, endpoints)
2. `frontend/src/editor/studyRouter_withinSubjects.tsx` - 4 critical issues
3. `frontend/webpack.config.js` - 4 issues (config, hardcoded values)
4. `frontend/jest.config.js` - 3 issues (config)
5. `frontend/package.json` - 15+ unused deps
6. `README.md` - 3 incorrect instructions
7. `STUDY.md` - 3 documentation errors
8. `docker-compose*.yml` - 3 issues (ports, env vars)

---

## Conclusion

The codebase has solid foundational architecture but needs significant work in:
1. **Security** - Backend authentication must be implemented
2. **Testing** - Virtually no test coverage
3. **Consistency** - Many half-implemented features
4. **Documentation** - Inaccurate and incomplete

The good news: Most issues are fixable without major refactoring. Prioritizing the critical security issues and study bugs will stabilize the system for production use.
