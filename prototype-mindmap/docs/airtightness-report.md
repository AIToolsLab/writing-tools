# Airtightness Report

Current enforcement appendix for `prototype-mindmap`. `DESIGN.md` is the
canonical product/design source. This report tracks which philosophical
constraints are enforced in code, which are prompt-level, and where the residual
soft spots are. Current verification: `127/127` tests passing.

## Central Principle

The user authors every idea, label, hierarchy, role, and connection. The AI may
interpret and ask, but it cannot commit ungrounded structure. Validation gates
AI reflections only; direct user map actions are never blocked by validation.

## Code-Enforced Constraints

| Constraint | File(s) | Mechanism |
| --- | --- | --- |
| Reflections use the user's words | `validator.ts` | Lexical grounding requires broad overlap >= `0.8` and additions <= `0.15`. |
| Relationships/hierarchy in mirrors come from the user | `validator.ts` | Span grounding requires cited user spans; hierarchy/connection claims need relational/containment wording grounded in one utterance. |
| Readiness cannot be gamed by the LLM | `controller.ts`, `signals.ts`, `readiness.ts` | Relation signals and spontaneity are code-derived; LLM only groups evidence ids. |
| Hierarchy readiness needs spontaneous containment language | `readiness.ts` | `requireSpontaneousForHierarchy` blocks purely prompted containment. |
| AI cannot commit mirror structure | `controller.ts`, `App.tsx` | Passing mirrors become confirmable chunks; only user-confirmed chunks become cards. |
| LLM mirror prose cannot leak | `controller.ts` | Passing mirror text is a fixed preamble; only validated claims are shown for confirmation. |
| Failed mirrors fail closed | `controller.ts` | Validation failure routes to clarify with `weakestSpan`; no model retry/rephrase is shown. |
| Stuck users are not mirrored | `controller.ts` | `isStuck` forces clarify and clears the stale clarify pin. |
| Pacing is enforced | `controller.ts`, `config.ts` | Too-soon mirrors are downgraded to questions. |
| Only ready candidates can mirror | `controller.ts`, `readiness.ts` | Mirror claims are filtered to post-update ready candidate ids before validation. |
| AI cannot re-mirror placed structure | `controller.ts` | `claimAlreadyOnMap` drops claims whose normalized text matches an existing card; if all claims are already placed the turn downgrades to a question (`already_on_map` suppression), preventing duplicate cards. |
| Carry-forward is fenced | `controller.ts`, `readiness.ts` | `carryForwardCandidateIds` accelerates density only for idea candidates grounded in this turn. |
| Large exploratory turns are not harvested | `controller.ts`, `turn-shape.ts` | Code classifies long turns; exploratory mirror attempts downgrade to a focusing question, and broad multi-idea upserts are dropped. |
| Malformed model output is contained | `api.ts` | Unknown modes coerce to question; malformed claims/spans are filtered. |
| Source Bank is ground truth | `store.ts` | User chat, declarations, and map edits are append-only source utterances. |
| Direct card commands use exact user words | `controller.ts`, `map-commands.ts` | `create_card` requires exact current-turn phrase and matching cited id; referential/declarative/tentative cases are blocked. |
| Direct nesting commands do not guess references | `controller.ts`, `map-commands.ts`, `map-store.ts` | `nest_card` executes on exact references; unique near matches become pending confirmations; ambiguous near matches ask which card; `setParent` cycle guard applies. |
| Direct connection commands do not guess endpoints | `controller.ts`, `map-commands.ts`, `map-store.ts` | `connect_cards` executes on exact references; unique near matches become pending confirmations; ambiguous near matches ask which card; same-card edges are dropped. |
| AI cannot invent command labels | `controller.ts`, `map-commands.ts` | Labels must be exact current-turn phrases. Ungrounded labels are stripped; the edge remains unlabeled. |
| User map actions are undoable | `App.tsx`, `map-store.ts`, `map-commands.ts` | Command batches, edits, nesting, and connections go through map/bank snapshots. |
| Shared-bank integration is enforced by tests | `App.tsx`, `map-commands.test.ts`, `map-store.test.ts` | Map/command writes use the same `SourceBank` instance the loop reads. |
| Card sizes cannot brick the canvas | `map-store.ts` | `clampCardSize` bounds every `setSize` write and every `loadSnapshot` size to `120-1200` x `60-1200`, so a runaway/invalid persisted height can never render a full-canvas card. |
| Calibration is separate from enforcement | `config.ts` | Thresholds, pacing, and slider transformations live in config. |

## Important Code Details

### Mirror Validation

`validator.ts` runs checks per claim. Lexical grounding measures whether the
claim's content words trace to the Source Bank. Span grounding checks each
`sourceSpan`; relational targets also require relationship language grounded in a
single utterance. A failed claim yields `weakestSpan`, which the controller uses
for clarify.

### Readiness

`readiness.ts` evaluates source density, relation clarity, and unsupported risk.
For hierarchy, at least one containment signal must be spontaneous. Relation
signals are detected by `signals.ts` and attached by `controller.ts` only when the
LLM grouped the corresponding utterance into a candidate.

### Carry-Forward

The model may mark `carryForwardCandidateIds`, but code filters them to idea
candidates with substantive evidence from this turn. Acceleration satisfies
density only. Validation and user confirmation remain unchanged.

### Large Turns

`turn-shape.ts` classifies the latest segmented user turn as compact, large
exploratory, or large selected. Large exploratory turns are treated as material
for selection: mirror attempts are downgraded to a focusing question, and broad
multi-idea candidate upserts are filtered. Large selected turns may proceed only
through existing carry-forward, validation, confirmation, and command gates.

### Direct Map Commands

`mapCommands` are side effects, orthogonal to chat `mode`.

- `create_card`: exact current-turn card phrase; no mirror or confirmation.
- `nest_card`: exact/unique parent reference, or a unique near-match reference
  after the user confirms it; child is existing exact/confirmed card or exact
  current-turn phrase.
- `connect_cards`: exact/unique endpoints, or unique near-match endpoints after
  the user confirms them; optional label must be exact current-turn wording.

The controller trusts the LLM to interpret speech acts, then code fences the
consequential act. Declaratives such as "X supports Y" are blocked from command
execution and stay on the mirror/question path. Fuzzy structure references never
auto-execute: unique near matches ask "did you mean X?", and ambiguous matches
ask the user which card.

### Diagnostics

`controller.ts` emits `suppressionReason`, `suppressionDetail`, `validationDebug`,
`acceleratedCandidateIds`, and `readinessNotes`. `Map.tsx` surfaces these in the
Debug panel.

## Prompt-Level Constraints

These shape behavior but are not the final enforcement boundary:

- `PHILOSOPHY` and question rules in `api.ts`
- dynamic pacing/readiness/clarify/stuck notes
- carry-forward/declaration pressure instructions
- direct map command instructions
- no-harvest guidance for large/exploratory turns
- mirror-mode source-span instructions

Prompt failures are expected to be caught by controller/validator/command fences
where the act would become consequential.

## Residual Soft Areas

- Question quality remains prompt-level. Code prevents some repeated/suggestive
  patterns, but cannot prove a question is always intuitive.
- Signal detection is keyword-based; under-detection is safe but can require the
  user to rephrase relationships.
- Stemming/normalization is simple.
- Candidate grouping is LLM-interpreted. Bad grouping is bounded by readiness,
  validation, and confirmation, but can slow the conversation.
- Command speech-act interpretation is LLM-owned. Code blocks obvious
  declarative/tentative/referential mistakes, exact-span violations, stale ids,
  ambiguous references, unconfirmed near matches, and ungrounded labels.
- Near-match scoring is intentionally simple substring/token containment. It is
  used only to ask the user, never to execute structure without confirmation.

## File Responsibility Summary

| File | Responsibility |
| --- | --- |
| `validator.ts` | Lexical and span/relationship grounding for mirrors. |
| `readiness.ts` | Candidate readiness and hierarchy hard rule. |
| `signals.ts` | Deterministic relation/containment detection. |
| `turn-shape.ts` | Deterministic large-turn classification for no-harvest behavior. |
| `controller.ts` | Orchestration, code-derived signals, mirror gates, carry-forward filtering, command acceptance, diagnostics. |
| `store.ts` | Source Bank and Candidate Store. |
| `map-store.ts` | Thought units, parent/child nesting, connections, positions, snapshots. |
| `map-commands.ts` | Applies accepted direct map commands to the map and Source Bank. |
| `config.ts` | Calibration thresholds and slider-derived pacing. |
| `api.ts` | LLM prompt, output contract, defensive parsing. |
| `App.tsx` | Session state, mirror confirmation, command application, undo, persistence. |
| `Map.tsx` | Visual concept map and debug surface. |
| `types.ts`, `llm-contract.ts` | Domain and LLM contract types. |
