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

### Pages and the navbar

`src/pages/registry.tsx` is the single source of truth for which pages exist and
where they appear. Adding a page is one `PageName` member (`src/contexts/
pageContext.tsx`) plus one registry entry — the navbar and `pages/app` both read
from the registry, so neither needs editing.

- `tier: 'core'` — an inline tab. **Capped at three** (`MAX_CORE_PAGES`), which
  `src/pages/__tests__/registry.test.ts` enforces.
- `tier: 'lab'` — in progress; reachable from the Labs (···) menu instead. Every
  lab page shares that one button, so the strip's width doesn't grow with the
  number of experiments in flight.

The cap is a platform constraint, not a style rule: the Google Docs sidebar is
locked at ~300px with no splitter, which leaves 57.3px of label per tab beside the
Labs button. A fourth core tab drops that to 37.0px, under the widest label
("Revise", 39.8px). In-progress work belongs in `lab`.

`enabled` (optional) hides a page entirely — see `src/pages/flags.ts`. Note the
URL override there only reaches the standalone editor and dev server: the Word
task pane's URL comes from `manifest.xml`, and the Google Docs bundle runs inside
an Apps Script sandbox iframe with no addressable URL. The Labs menu is the
cross-surface way in; flags are for keeping something out of even that.

### Document-scoped settings

`EditorAPI` has `getDocumentSetting`/`setDocumentSetting` for small values that
belong to the *document* rather than the user or the browser: they survive a
reload and follow the file to whoever opens it next. Word backs them with
`Office.context.document.settings` (`set` alone only touches the in-memory copy —
`saveAsync` is what writes the file), Google Docs with Apps Script document
properties (`google-docs-addon/Code.gs`, bridged in `sidebar.html`). The
standalone editor and the bare context default fall back to
`localStorageDocumentSettings` (`src/api/documentSettings.ts`), namespaced per
document. The Google Docs surface falls back to it too when the installed Apps
Script deployment predates the document-property bridge — the bundle and the
add-on are deployed separately, so their versions drift.

The writer's **brief** (audience / purpose / constraints) is the first consumer:
`contexts/docBriefContext.tsx` loads it once under `DocBriefProvider` (mounted
in `pages/app`), debounces writes back to the document, and flushes on unmount
and `pagehide`. Pages read it with `useDocBrief()`, render `<BriefSection>` to
let the writer edit it from wherever they are, and fold it into their requests
with `formatDocBriefForPrompt` — which returns null when nothing is set, because
telling the model about an empty brief reads as a constraint of its own.

Two naming constraints, both from `docs/design/interface-concepts.md`. **"Goal"
and "to-do" are reserved**: a goal there is a Charter criterion the writer grades
and renegotiates, and a to-do is the Charter's Worklist. A brief is *stated*, so
it doesn't squat on either. And the fields are deliberately facts about the
document (the rhetorical situation), never instructions to the model — nothing in
the add-in rewrites the writer's prose, so "don't touch my opening" has nothing to
bite on, and asking for it frames the writer as a supervisor of an output machine.
Add a field only if a human collaborator would want to know it too.

### Generation calls and failures

Pages must generate through `src/api/generate.ts` (`streamTextDeltas`,
`generateFullText`), never by calling `streamText` directly. `streamText` does not
throw on model or transport errors: it puts them in the stream as an `error` part,
and `result.textStream` forwards only `text-delta` parts. A failed generation is
therefore indistinguishable from an empty successful one — the loop ends, `await
result.text` gives `''`, and the surrounding `try/catch` never runs. That is how a
quota failure reached writers as a blank panel. The helpers read `fullStream`
instead and throw a `GenerationError`.

Catch it, run the value through `describeGenerationError` (`src/api/errors.ts`),
and render the result with `<GenerationErrorNotice>`
(`src/components/errorNotice/`) — one writer-facing sentence, the provider's own
text behind a "Technical details" toggle, and Retry only when `info.retryable`.
Log `info.detail` (provider text) and `info.code`, not the sentence shown on
screen. A successful-but-empty generation is also a visible outcome (`tone="info"`
notice), never silence.

**The document read is part of the request, so put it inside the `try`.** Every
page pulls fresh context (`refresh()` from `useDocContext`) at request time, and
on Google Docs that pull is an Apps Script round-trip that fails on its own
terms: a sidebar left open long enough loses its grant and every bridge call
rejects with `ScriptError: Authorization is required to perform that action.`
When that `await` sits outside the `try/finally` — as it did in `pages/chat` —
the rejection escapes into a `void`-ed handler, the `finally` never runs, and the
in-flight flag stays true: a permanently disabled input box, an unchanged
transcript, and nothing on screen saying why. `describeGenerationError` maps that
`ScriptError` to copy naming the one step that works (reopen the sidebar) with
`retryable: false`, since retrying in place cannot re-authorize. The one
exception is a read on a background timer (draft's auto-refresh), which skips the
cycle with a `console.warn` rather than interrupting the writer with a notice
they didn't ask for.

**The system prompt goes in `instructions`, never in `messages`.** Since ai@7, a
`role: 'system'` message inside `messages` fails validation before the request
leaves the browser — `InvalidPromptError: System messages are not allowed in the
prompt or messages fields. Use the instructions option instead.` — which reaches
the writer as a generation error on every request. Pass the system prompt as the
`instructions` option (a string) alongside `messages`; the SDK puts it back at
the head of the prompt itself. This bites hardest where a page keeps a
conversation in state: the chat transcript (`pages/chat`) holds only the
doc-context, greeting, user, and assistant messages, with `CHAT_INSTRUCTIONS`
kept outside it.

### Testing

Two runners own two disjoint directories — never mix them:

- **Vitest** (unit/integration) — `src/`, files named `*.test.ts(x)`, colocated in
  `__tests__/`. Scoped via `include` in `vitest.config.ts`. Run with `npm test`
  (or `npm run test:watch`).
  - LLM calls are tested by passing a `MockLanguageModelV3` (from `ai/test`) as the
    `model` arg to `streamTextDeltas`/`generateFullText` — see
    `src/api/__tests__/generate.test.ts`, including how to stream an `error` part.
- **Playwright** (E2E/visual) — `tests/`, files named `*.spec.ts`. Scoped via
  `testDir` in `playwright.config.ts`. Run with `npx playwright test`.

Keep unit tests in `src/` and E2E specs in `tests/`. If a unit runner's globs reach
into `tests/`, Playwright specs fail with "test.describe() did not expect to be called
here". The `.test.ts` vs `.spec.ts` split is a second, intentional guardrail.

`vitest.config.ts` passes `--no-webstorage` to the pool workers on Node ≥ 25.
Node enables Web Storage by default there, so `localStorage` exists as a global
that stays `undefined` without `--localstorage-file`; Vitest's DOM environments
only copy a window property onto `globalThis` when nothing is already there, so
that stub shadows jsdom's real Storage and jsdom tests fail with "Cannot read
properties of undefined". CI on `lts/*` (Node 24) never saw it, which is why the
guard checks `allowedNodeEnvironmentFlags` — the flag doesn't parse before Node
25 and would abort the worker. Switching DOM libraries doesn't help: happy-dom
loses `localStorage` the same way, because the shadowing is in the runner.

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

