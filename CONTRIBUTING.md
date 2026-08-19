# Contributing

Most of what you need is documented next to the code it describes. This file is the index.

## Which app are you changing?

This monorepo holds two independent applications:

- **Production add-in** — `frontend/` (TypeScript/React Office Add-in) plus `backend/`
  (TypeScript [Hono](https://hono.dev) server: OpenAI proxy + JSONL study logging).
  They are separate apps in source, but ship as a single container built from the
  repo-root `Dockerfile`, with the backend serving the built frontend in production.
- **Experiment app** — `experiment/`, a separate Next.js app for the user study. It does
  not use `frontend/` or `backend/`.

If it's ambiguous which one a task belongs to, ask rather than guessing.

There are also standalone prototypes — `prototype-mindmap/`, `prototype-word-bank/`,
`google-docs-addon/` — each with its own README, plus `sandbox/` for loose
experiments and prompt drafts.

## Where things are documented

| Topic | See |
| --- | --- |
| Running the backend, its endpoints, env vars, deploy | [backend/README.md](backend/README.md) |
| Frontend build, dev server, entry points | [frontend/CLAUDE.md](frontend/CLAUDE.md) |
| Frontend build-output contract tests | [frontend/TESTING.md](frontend/TESTING.md) |
| Visual regression tests and baselines | [VISUAL_REGRESSION.md](VISUAL_REGRESSION.md) |
| Experiment app | [experiment/README.md](experiment/README.md) |
| Architecture and design notes | [docs/](docs/) |
| CI workflows | [.github/workflows/](.github/workflows/) |

## Two things that surprise people

**Playwright baselines are CI-only.** They're pixel-stable only in CI's pinned container,
so don't regenerate them on your machine. Run the **Frontend Tests** workflow with
**Regenerate Playwright visual snapshots** checked and it commits fresh baselines to your
branch. See [VISUAL_REGRESSION.md](VISUAL_REGRESSION.md).

**Pushing to `main` runs a typecheck.** A Husky `pre-push` hook typechecks `experiment/`
whenever the target ref is `main`, and *rejects the push* if it fails — even when your
change never touched `experiment/`. Fix the errors, or `git push --no-verify` to skip.

## Pull requests

- Keep each PR to one feature or fix, and link its issue (`Closes #123`).
- Get a teammate's review before merging, and let CI go green first.
- No branch-name or commit-message prefix scheme is enforced. Write a clear imperative
  subject line and don't worry beyond that.

Task tracking is GitHub Issues. The `backlog/` folder is a legacy system kept for
reference; it's worth a grep for context, but new work goes in Issues.
