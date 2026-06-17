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
  - `logs.html`, `popup.html`, `commands.html`, `index.html` (landing page)
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

