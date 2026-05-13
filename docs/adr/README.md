# Architecture Decision Records

This directory captures intentional design decisions for the writing-tools
repo, so students and coding agents can tell what is settled, what is under
revision, and what is just emergent state.

## Status vocabulary

- **Accepted** — intentional, working, do it this way.
- **Accepted (revisit)** — current practice, but known-troublesome; the
  "Known issues" section spells out what hurts.
- **Emergent** — never actually decided; documents reality and flags whether
  to ratify or replace.
- **Proposed** — under consideration; not yet in effect.
- **Superseded by NNNN** — replaced by a later ADR.
- **Deprecated** — was a decision; no longer applies.

## Where things live

- `docs/adr/` — *why* decisions (this directory).
- `docs/specs/` — *what* the system must do (observable contracts).
- `STUDY.md`, app-level `CLAUDE.md` files — *how* to use specific subsystems.

ADRs link to specs and docs; they don't restate them.

## Authoring

Copy `_template.md`, give it the next four-digit number, fill it in, link it
from the index below.

## Index

- [0001 — LLM for thinking, not for writing](0001-llm-for-thinking-not-writing.md)
