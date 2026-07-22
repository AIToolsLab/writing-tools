TypeScript/React Microsoft Office Add-in for Word + standalone editor

**Central concept**: LLM helps thinking and reflection instead of replacing writing.

`npm` package manager.


### Frontend (Office Add-in)
- **Office.js APIs** - Microsoft Word integration
- **State Management**: Jotai atoms (see `frontend/src/contexts/`)
- **Build**: Vite (`vite.config.ts`, multi-page app). `npm run build` →
  `dist/`; `npm run dev-server` for the HTTPS dev server on :3000. The Google
  Docs bundle builds separately via `vite.google-docs.config.ts`
  (`npm run build:google-docs`) into `dist/google-docs.bundle.js`.
- **Path Alias**: `@/*` maps to `./src/*` (vite + tsconfig)
- **Entry Points** (HTML lives at the frontend root, as Vite build inputs):
  - `taskpane.html` - Word task pane
  - `editor.html` - Standalone demo editor
  - `logs.html`, `commands.html`, `index.html` (landing page)
- **Static assets**: `public/` (copied to `dist/` root; includes `manifest.xml`
  and `public/assets/`). Images imported in code live in `src/assets/`.
- **Manifest**: `frontend/public/manifest.xml` for Office Add-in configuration

### Testing

Two runners own two disjoint directories — never mix them:

- **Vitest** (unit/integration) — `src/`, files named `*.test.ts(x)`, colocated in
  `__tests__/`. Scoped via `include` in `vitest.config.ts`. Run with `npm test`
  (or `npm run test:watch`). Node environment by default; for a component test add
  `// @vitest-environment jsdom` at the top of that file.
  - LLM calls are tested by passing a `MockLanguageModelV2` (from `ai/test`) as the
    `model` arg to `streamText`/`generateText` — see `src/api/__tests__/generate.test.ts`.
- **Playwright** (E2E/visual) — `tests/`, files named `*.spec.ts`. Scoped via
  `testDir` in `playwright.config.ts`. Run with `npx playwright test`.

Keep unit tests in `src/` and E2E specs in `tests/`. If a unit runner's globs reach
into `tests/`, Playwright specs fail with "test.describe() did not expect to be called
here". The `.test.ts` vs `.spec.ts` split is a second, intentional guardrail.

### Event logging

Each page calls `useLog()` once (see `src/hooks/useLog.ts` — it owns transport,
session identity, and consent stripping) and passes the resulting `LogFn` to the
typed helpers in `src/api/logging.ts` (`draftLog`, `reviseLog`, `chatLog`). Every
event is written with a consistent envelope:

```
{ schema_version, page, event, timestamp, ...payload }
```

- `page` scopes the event to the tab that emitted it (`draft` | `revise` | `chat`).
- `event` is a snake_case verb phrase, unique within its page (e.g.
  `suggestion_requested`, `visualization_completed`, `message_sent`).
- `schema_version` is stamped from `LOG_SCHEMA_VERSION`. Bump it (and add a
  history line in `logging.ts`) whenever the envelope or a payload changes shape.
  Pre-schema events have no `schema_version`; readers treat those as version 0.
- Identity is the session user id, added server-side — never send a username.

Add new events by adding a method to the relevant page's helper object so the
naming convention and payload types stay in one place. Content-bearing payload
fields must use names the consent gate recognizes (`src/consent.ts`
`KEY_MIN_LEVEL`) so they're stripped to the user's level: `docContext` /
`message` / `target` are document text, `result` / `response` are AI output;
everything else is usage-level metadata. The backend (`backend/src/logging.ts`)
promotes `schema_version` and `page` to first-class columns on each JSONL entry.

