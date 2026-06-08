# CLAUDE.md

Guidance for Claude Code when working with this repository.

## Project Components

This monorepo has two separate applications. If it's ambiguous which one to use, **ask the user for clarification**.

- **Production add-in** (see [frontend/CLAUDE.md](frontend/CLAUDE.md) and [backend/CLAUDE.md](backend/CLAUDE.md))
  - `frontend`: TypeScript/React Microsoft Office Add-in
  - `backend`: TypeScript Hono server (Node) — OpenAI proxy + JSONL study logging

- **Experiment app** (see [experiment/CLAUDE.md](experiment/CLAUDE.md))
  - `experiment`: Separate Next.js application (does not use frontend/backend)

<!-- BACKLOG.MD MCP GUIDELINES START -->

<CRITICAL_INSTRUCTION>

## BACKLOG WORKFLOW INSTRUCTIONS

This project uses Backlog.md MCP for all task and project management activities.

**CRITICAL GUIDANCE**

- If your client supports MCP resources, read `backlog://workflow/overview` to understand when and how to use Backlog for this project.
- If your client only supports tools or the above request fails, call `backlog.get_backlog_instructions()` to load the tool-oriented overview. Use the `instruction` selector when you need `task-creation`, `task-execution`, or `task-finalization`.

- **First time working here?** Read the overview resource IMMEDIATELY to learn the workflow
- **Already familiar?** You should have the overview cached ("## Backlog.md Overview (MCP)")
- **When to read it**: BEFORE creating tasks, or when you're unsure whether to track work

These guides cover:
- Decision framework for when to create tasks
- Search-first workflow to avoid duplicates
- Links to detailed guides for task creation, execution, and finalization
- MCP tools reference

You MUST read the overview resource to understand the complete workflow. The information is NOT summarized here.

</CRITICAL_INSTRUCTION>

<!-- BACKLOG.MD MCP GUIDELINES END -->
