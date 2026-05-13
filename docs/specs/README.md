# Behavioral specs

Observable-behavior contracts for the writing-tools system. These pin down
*what* the system must do, so implementations can be refactored or rebuilt
without silently changing semantics the study or the product depends on.

How this differs from neighbouring docs:

- ADRs (`docs/adr/`) say *why* we picked an approach.
- Specs (here) say *what* the contract is.
- `STUDY.md` and app-level `CLAUDE.md` files say *how* to use the system.

## Planned specs

- `api-contract.md` — `/api/get_suggestion`, `/api/log`, SSE framing.
- `logging-schema.md` — event names, fields, redaction rules for production
  vs. study users (backend logs and PostHog).
- `surfaces.md` — runtime surfaces: Word task pane, Google Docs add-on, demo
  embed, standalone editor.

Study-mode contracts (URL params, condition codes, localStorage keys) live in
[`/STUDY.md`](../../STUDY.md); don't duplicate them here.
