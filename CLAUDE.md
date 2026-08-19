# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Components

This monorepo has two separate applications. If it's ambiguous which one to use, **ask the user for clarification**.

- **Production add-in** (see [frontend/CLAUDE.md](frontend/CLAUDE.md) and [backend/CLAUDE.md](backend/CLAUDE.md))
  - `frontend`: TypeScript/React Microsoft Office Add-in
  - `backend`: TypeScript Hono server (Node) — OpenAI proxy + JSONL study logging
  - Deploys as a single container (repo-root `Dockerfile`): the backend serves the
    built frontend in production. `frontend`/`backend` remain separate apps in source.

- **Experiment app** (see [experiment/CLAUDE.md](experiment/CLAUDE.md))
  - `experiment`: Separate Next.js application (does not use frontend/backend)

## Workflow

Use GitHub Issues for task management. Note that this project once used `backlog.md` (the `backlog` folder), so it may be worth a quick grep through `/backlog` to see if there are any relevant tasks.

- Check for issues that may be relevant to the current task.
- A Husky `pre-push` hook typechecks `experiment/` when the push target is `main`,
  and rejects the push if it fails — even for changes that don't touch `experiment`.
  It does not run when pushing a feature branch.
- Keep `/docs` up to date. (grep for relevant existing docs; create new docs as needed; don't worry about keeping style consistent across documents though.)
