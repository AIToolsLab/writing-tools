---
id: 0001
title: LLM for thinking, not for writing
status: Accepted
date: 2026-05-13
---

# 0001: LLM for thinking, not for writing

## Context

The product's purpose is to help writers think — about audience, structure,
gaps in reasoning — not to produce text on their behalf. Motivating concerns:
over-reliance on AI, the machine-ification of human writing, and
over-emphasis on superficial polish at the expense of thinking about audience
and argument. Supporting literature lives in published papers; this ADR
captures only the operational consequences for the codebase.

## Decision

Features in the production add-in must support reflection on the user's own
writing rather than producing text the user would paste verbatim into their
document.

**Litmus test for new features:** *Does it produce text the user would copy
verbatim into their document?* If yes, it is not aligned.

Forbidden patterns in the production product:

- Tab-to-accept inline completions
- Ghost-text autocomplete
- "Rewrite this paragraph" buttons
- Full-draft generation as a user-facing feature

Aligned patterns (current `gtype`s in `backend/nlp.py`):

- `analysis_readerPerspective`, `proposal_advice` — reflection on reader and
  argument
- `example_sentences` — prompts the writer's own thinking, not text to paste

## Alternatives considered

- **Completion-style assistance (Copilot / ghost-text).** Rejected on the
  grounds above.
- **Predictive-text interactions.** Under active investigation as a possible
  exception, framed as a faster alternative to bulk copy-paste rather than as
  open-ended completion. Real tensions around over-reliance and
  short-circuiting thinking remain; may produce a follow-up ADR that refines
  or carves out from this one.

## Consequences

- Users arriving from Copilot- or Grammarly-style tools may find the product
  less immediately "useful" by that frame. That is expected, not a bug.
- New `gtype`s must pass the litmus test before being added to the production
  add-in.
- The `experiment/` app intentionally contains full-completion modes as
  research probes (e.g., measuring over-reliance). Those are not endorsed
  patterns for the production product.

## Known issues / revisit triggers

- `backend/nlp.py` exposes a `complete_document` `gtype` (see
  `backend/nlp.py:94` and the special-case handling around
  `backend/nlp.py:229`). The research probe for full-completion behavior
  lives in `experiment/`; the presence of `complete_document` in the
  production backend may be unintentional. Investigate and either document
  the intentional research use or remove.
- A predictive-text ADR is anticipated and may refine or carve out from this
  one.
