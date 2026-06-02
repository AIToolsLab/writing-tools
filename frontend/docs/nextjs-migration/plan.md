# Next.js 16 migration — progress

Living checklist for porting the production add-in (`frontend/` webpack SPA + Python
proxy) to a single Next.js 16 app. Full rationale lives in the approved plan; this file
tracks execution and is updated as part of every commit. See `log.md` for anything
interesting / unexpected / challenging encountered along the way.

## Scope (this pass)

- One unified Next.js app serves UI + API; ai-sdk model calls move server-side.
- Everything **except auth and Google Docs** (both deferred). Taskpane endpoint wired up.
- Anonymous-only (Auth0 removed); clean seam left for Better-Auth later.
- Logging stays in Python (proxied via Next rewrites).

## Checklist

- [x] 0. Seed living docs (`plan.md`, `log.md`)
- [x] 1. Scaffold base Next 16 app (mirror `experiment/` conventions)
- [x] 2. Wire taskpane endpoint (`/taskpane.html` → `/taskpane` rewrite, assets)
- [x] 3. AI route handlers (`/api/chat`, `/api/draft`, `/api/revise`) + prompts + tests
- [x] 4. Shared types, contexts, utilities (drop Auth0 from `EditorAPI`)
- [ ] 5. Standalone surface `/` (Lexical editor + Draft/Revise/Chat, rewired to AI routes)
- [ ] 6. Word taskpane surface `/taskpane` (Office.js, onReady gating, wordEditorAPI)
- [ ] 7. Log viewer `/logs` + logging proxy rewrites to FastAPI
- [ ] 8. Commands FunctionFile, manifest prod build, deploy wiring, cleanup

## Deferred (follow-ups)

- Auth: Better-Auth device-code flow, anonymous-usage limit + SignInGate.
- Google Docs: Apps Script shell iframes Next route, postMessage bridge for `EditorAPI`.

## Verification

- Per commit: `npm run build`, typecheck, lint, `npm test` (vitest) green.
- Vitest is the primary gate; Playwright (`*.spec.ts`) is a non-blocking smoke signal.
