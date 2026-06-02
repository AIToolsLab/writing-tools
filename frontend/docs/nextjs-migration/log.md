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
