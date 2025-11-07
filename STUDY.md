# User Study Mode

The application includes a built-in user study system for conducting writing research experiments.

## Study Flow

The study follows a linear progression through pages controlled by `frontend/src/editor/studyRouter.tsx`:

1. **study-consentForm** - Redirects to external Qualtrics consent form
2. **study-intro** - Welcome page with study overview and instructions
3. **study-introSurvey** - Demographic and AI familiarity questions
4. **study-startTask** - Pre-task instructions
5. **study-task** - Main writing task with AI assistance
6. **study-postTask** - Post-task survey (TLX, experience questions)
7. **study-final** - Completion page with optional Prolific code

## Accessing Study Mode

Study pages are accessed via URL parameters:
```
/editor.html?page=study-intro&username=USER_ID&condition=CONDITION_CODE
```

### Required Parameters

- `username` - Unique participant identifier
- `condition` - Condition code mapping to different AI assistance modes:
  - `g` → example_sentences (3 example next sentences)
  - `a` → analysis_readerPerspective (3 reader reactions)
  - `p` → proposal_advice (3 pieces of directive advice)
  - `n` → no_ai (no AI assistance, static message only)
  - `f` → complete_document (AI generates full completed document)

### Optional Parameters

- `isProlific=true` - Shows completion code on final page
- `contextToUse=true|false|mixed` - Controls which context the AI uses (not applicable for no_ai)
- `autoRefreshInterval=10000` - Interval (ms) for auto-refreshing AI suggestions (disabled for no_ai and complete_document)

## Study Configuration

Key configuration in `frontend/src/editor/studyRouter.tsx`:
- `wave` - Study wave identifier (currently "wave-2")
- `completionCode` - Prolific completion code
- `letterToCondition` - Maps condition codes to condition names
- Task content in `summarizeMeetingNotesTask` and `summarizeMeetingNotesTaskFalse`

## Study State Management

Study-specific state is managed via Jotai atoms:
- `overallModeAtom` (`frontend/src/contexts/pageContext.tsx`) - Set to `OverallMode.study` during studies
- `studyDataAtom` (`frontend/src/contexts/studyContext.tsx`) - Stores:
  - `condition` - Current condition name
  - `trueContext` - Correct task context
  - `falseContext` - Intentionally incorrect context (for mixed conditions)
  - `autoRefreshInterval` - Refresh interval for AI suggestions
  - `contextToUse` - Which context to provide to AI

## Logging

All study interactions are logged to the backend via `log()` function in `frontend/src/api/index.ts`.

### Key Logged Events

- `view:{pageName}` - Page views (logged on every page)
- `Started Study` - Study initiation with browser metadata
- `taskStart` / `taskComplete` - Task boundaries
- `Document Update` - Document state changes during study mode (logged in `frontend/src/editor/index.tsx:105-111`)
- `surveyComplete:{surveyName}` - Survey submissions with responses

### Browser Metadata Captured

- User agent, screen/window dimensions, color depth
- Timezone, language preferences, platform
- Cookie/online status

## Study Components

- **EditorScreen** (`frontend/src/editor/index.tsx`) - Main editor with word count display in study mode
- **StudyRouter** (`frontend/src/editor/studyRouter.tsx`) - Manages study page routing and state
- **Survey** (`frontend/src/surveyViews.tsx`) - Reusable survey component
- **SurveyData** (`frontend/src/surveyData.tsx`) - Pre-defined survey questions

## Document Storage

Documents are stored in localStorage with task-specific keys:
- Study tasks: `doc-{taskID}`
- Regular editor: `doc`
