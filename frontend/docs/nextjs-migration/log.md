# Next.js 16 migration — log

Running notes on anything interesting, unexpected, or challenging during the port:
Office.js vs SSR gotchas, ai-sdk stream-shape surprises, dead-config discoveries,
decisions made mid-flight, etc. Newest entries at the bottom.

## Entries

- **Commit 0 — seeding docs.** Started on branch `claude/nextjs-16-migration-4H0Is`,
  Node v22.22.2 / npm 10.9.7. Working tree clean. Established `plan.md` (checklist) and
  this log. The `experiment/` app is the reference for all Next conventions and must not
  be modified.

- **Commit 1 — scaffold.** Scaffolded with `create-next-app@canary` into a temp dir to
  see the current layout, but **aligned all dependency versions to `experiment/`'s
  `package.json`** instead of canary (Next `16.2.6`, React `19.2.3`,
  `eslint-config-next 16.1.1`, etc.). Rationale: `experiment/` is the team reference and
  we want one consistent Next/React/ai-sdk toolchain across the monorepo, not a moving
  canary target. Hand-authored the config files (`next.config.ts`, `tsconfig.json`,
  `eslint.config.mjs`, `postcss.config.mjs`, `vitest.config.ts`, `vitest.setup.ts`,
  `app/`) to mirror `experiment/` exactly.
- **Gotcha: `src/pages` collides with Next's Pages Router.** The legacy webpack app lives
  in `frontend/src/`, and `src/pages/` is reserved by Next (src-dir Pages Router), so
  `next build` errored with "`pages` and `app` directories should be under the same
  folder". Fix: **renamed `src/` → `legacy/`** (it's excluded from build/lint/typecheck/
  vitest and will be ported then deleted in commit 8). All exclude references updated
  `src` → `legacy`.
- **Removed `babel.config.json`.** Next/Turbopack auto-detects a Babel config and falls
  back off SWC (disabling React Compiler) if one is present. Deleted it (plus the
  conflicting legacy `eslint.config.js`, `postcss.config.js`, `tailwind.config.js` — note
  Tailwind 4 needs no JS config). Webpack configs, Dockerfile, nginx.conf, biome.json,
  playwright.config.ts are left in place until the commit 8 cleanup.
- **Deferred deps to their commits** to keep this one minimal: `lexical`/`reshaped`/
  `react-icons`/`react-remark`/posthog (commit 5, with the UI port — also where React 19
  peer compatibility for `lexical`/`reshaped` gets resolved), Office tooling +
  `@types/office-js` (commit 6). Added `passWithNoTests` to the vitest config so the empty
  suite stays green until tests arrive in commit 3.
- **Validated:** `npm run build` ✓, `typecheck` ✓, `lint` ✓, `test` ✓, dev server serves
  `/` (200, title "Thoughtful").

- **Commit 2 — taskpane endpoint.** The manifest hard-codes three URL families against
  `https://localhost:3000`: `/taskpane.html` (task pane), `/commands/commands.html`
  (ribbon FunctionFile), and `/assets/logo*.png` (icons). Added a `next.config` rewrite
  `/taskpane.html` → `/taskpane` and a placeholder `/taskpane` route; moved `assets/` →
  `public/assets/` so the icon URLs resolve. `/commands/commands.html` is handled in the
  commit 8 cleanup. **Manifest left untouched** (no re-validation, per scope).
- **Note for commit 6:** Office sideloading requires **HTTPS** on `localhost:3000` with a
  trusted cert (the old flow used `office-addin-dev-certs` + webpack-dev-server https).
  `next dev` is HTTP by default; we'll use `next dev --experimental-https` (or the office
  certs) when wiring the real Word surface. Verified here over HTTP only.
- **Validated:** `build` ✓; dev server: `/taskpane.html` → 200 (serves the taskpane page,
  rewrite works), `/taskpane` → 200, `/assets/logo.png` → 200 `image/png`.

- **Commit 3 — AI route handlers (server-side ai-sdk).** Moved model calls off the
  browser. `lib/prompts.ts` ports the Draft prompts + `buildMessages` verbatim and adds
  the Chat and Revise system prompts + `buildRevisionPrompt` (was `getDocTextAsPrompt`).
  `lib/ai.ts` has three model-agnostic functions (`streamChat`, `generateSuggestion`,
  `streamRevision`) that take a `LanguageModel`, so tests inject `MockLanguageModelV2`.
  Routes are thin: `/api/chat` (UIMessage stream via `toUIMessageStreamResponse`),
  `/api/draft` (one-shot JSON `GenerationResult` — the Draft UI awaits the full text),
  `/api/revise` (`toTextStreamResponse`, raw text deltas). `lib/models.ts` owns the model
  id (`gpt-4o`, unchanged) and reads `OPENAI_API_KEY` from the env (no more browser proxy
  / `apiKey:'unused'`).
- **Contract for the commit-5 UI rewire:** chat POSTs `{ messages, system? }`
  (UIMessages); draft POSTs `{ type, docContext }` → `{ generation_type, result,
  extra_data }`; revise POSTs `{ docContext, request }` → text stream.
- **Snags:** (1) `ai/test` transitively requires `msw` (an old legacy devDep) — re-added
  to devDependencies. (2) `LanguageModelV2StreamPart` is exported from `@ai-sdk/provider`
  (a stable peer of `ai`), not from `ai`; imported the test's stream-part type from there.
  (3) Putting the system message inside `messages` triggers an AI SDK prompt-injection
  warning; `generateSuggestion` now passes it via the `system` option instead.
- **Runtime:** left routes on the default Node runtime (not edge) so future server-side
  logging/telemetry (e.g. posthog-node) can slot in without an edge rewrite.
- **Validated:** vitest (3 passed) ✓, typecheck ✓, lint ✓, build ✓ (routes show as
  dynamic ƒ). Live dev curl with a dummy key: `/api/chat` → 200 (stream opens),
  `/api/draft` → 500 with `AI_LoadAPIKeyError` (route reached, key read from env),
  GET `/api/draft` → 405 (route exists, POST-only).

- **Commit 4 — shared types, contexts, utilities.** Consolidated domain types as module
  exports in `lib/types.ts` (no global ambient `.d.ts` like the legacy `types.d.ts`):
  added `ChatMessage`, `SavedItem`, and `EditorAPI`. **Dropped `doLogin`/`doLogout` from
  `EditorAPI`** — those took an `Auth0ContextInterface`; auth re-enters later via a
  separate session seam, not the editor API. Ported `editorContext` (inert default),
  `chatContext`, `userContext`, a trimmed `pageContext` (`pageNameAtom` + `PageName`;
  dropped the `OverallMode` full/demo split — app is single anonymous mode),
  `selectionUtil` (+ its 8 tests, now importing `DocContext` from `@/lib/types` instead of
  the global), and the `useDocContext` hook.
- **SSR guards:** `userContext` read `window.location.search` at module load (crashes
  during SSR); guarded with `typeof window`. Client React files got `'use client'`
  (`editorContext`, `chatContext`, `useDocContext`); atom-only modules (`pageContext`,
  `userContext`) stay isomorphic. `getParagraphText` (uses the `Word` global) is deferred
  to commit 6 with `wordEditorAPI` so we don't pull Office types in yet.
- **Validated:** vitest 11 passed (8 selectionUtil + 3 ai) ✓, typecheck ✓, lint ✓,
  build ✓.
