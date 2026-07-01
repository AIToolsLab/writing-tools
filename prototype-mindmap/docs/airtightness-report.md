# Airtightness Report

Current enforcement appendix for `prototype-mindmap`. `DESIGN.md` is the
canonical product/design source. This report tracks which philosophical
constraints are enforced in code, which are prompt-level, and where the residual
soft spots are. Current verification: `155/155` app tests and `12/12` speech-hook
tests passing.

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
| Failed mirrors are legible | `controller.ts` | Clarify fallbacks explicitly acknowledge when the system was trying to carry something forward but could not place it cleanly yet. |
| Tentative mirrors preserve uncertainty | `validator.ts`, `config.ts` | Tentative source evidence mirrors only near the Map side of the slider, and accepted claims must retain uncertainty wording. |
| Rejected mirrors have a repair path | `App.tsx` | Declining a mirror chunk appends a repair question instead of leaving the user hanging. |
| Stuck users are not mirrored | `controller.ts` | `isStuck` forces clarify and clears the stale clarify pin. |
| Pacing is enforced | `controller.ts`, `config.ts` | Too-soon mirrors are downgraded to questions; the Think-to-Map slider shortens cooldown toward Map without changing readiness or validation gates. |
| Only ready candidates can mirror | `controller.ts`, `readiness.ts` | Mirror claims are filtered to post-update ready candidate ids before validation. |
| AI cannot re-mirror placed structure | `controller.ts` | `claimAlreadyOnMap` drops claims whose normalized text matches an existing card; if all claims are already placed the turn downgrades to a question (`already_on_map` suppression), preventing duplicate cards. |
| Carry-forward is fenced | `controller.ts`, `readiness.ts` | `carryForwardCandidateIds` accelerates density only for idea candidates grounded in this turn. |
| Large exploratory turns are not harvested | `controller.ts`, `turn-shape.ts` | Code classifies long turns; exploratory mirror attempts downgrade to a focusing question, and broad multi-idea upserts are dropped. |
| Sparse maps do not trigger early organizing | `controller.ts`, `api.ts` | Visible map state can block organize-mode questions even when candidate counts are high; organize outputs are rewritten into carry-forward prompts until the map has enough structure. |
| Immediate answers can satisfy the current ask | `controller.ts`, `api.ts`, `llm-contract.ts` | `activeElicitation` tracks the latest carry-forward / clarify target so a substantive next-turn answer biases toward a mirror attempt instead of another narrowing loop. |
| Malformed model output is contained | `api.ts` | Unknown modes coerce to question; malformed claims/spans are filtered. |
| Source Bank is ground truth | `store.ts` | User chat, declarations, and map edits are append-only source utterances. |
| Command provenance is not mirrorable | `controller.ts`, `store.ts`, `api.ts` | Command-consumed utterances remain in the Source Bank but are marked `commandOnly` and excluded from LLM-rendered bank context and candidate evidence replay. |
| Direct card commands use exact user words | `controller.ts`, `map-commands.ts` | `create_card` requires exact current-turn phrase and matching cited id; referential/declarative/tentative cases are blocked. |
| Direct nesting commands do not guess references | `controller.ts`, `map-commands.ts`, `map-store.ts` | `nest_card` executes on exact references; unique near matches become pending confirmations; ambiguous near matches ask which card; `setParent` cycle guard applies. |
| Direct connection commands do not guess endpoints | `controller.ts`, `map-commands.ts`, `map-store.ts` | `connect_cards` executes on exact references; unique near matches become pending confirmations; ambiguous near matches ask which card; same-card edges are dropped. |
| AI cannot invent command labels | `controller.ts`, `map-commands.ts` | Labels must be exact current-turn phrases. If labels are optional, missing/ungrounded labels are stripped and the edge remains unlabeled; if labels are required, the controller asks the user for the label instead of inventing one. |
| Required connection labels are user-supplied only | `controller.ts` | With label requirement on, resolved unlabeled connections become a pending label request; the next user turn completes the edge and is not rerouted into mirror/card creation. |
| Commands take precedence after gates pass | `controller.ts`, `App.tsx` | Accepted direct commands execute even in mixed turns, same-turn mirrors are suppressed, and complete non-uncertain commands suppress redundant coach follow-up. |
| Confirm follow-through does not fake user input | `App.tsx`, `controller.ts` | Post-confirm continuation runs with `ingestUser: false`, so the coach advances off updated map state without writing a synthetic utterance into the Source Bank. |
| User map actions are undoable | `App.tsx`, `map-store.ts`, `map-commands.ts` | Command batches, edits, nesting, and connections go through map/bank snapshots. |
| Shared-bank integration is enforced by tests | `App.tsx`, `map-commands.test.ts`, `map-store.test.ts` | Map/command writes use the same `SourceBank` instance the loop reads. |
| Card sizes cannot brick the canvas | `map-store.ts` | `clampCardSize` bounds every `setSize` write and every `loadSnapshot` size to `120-1200` x `60-1200`, so a runaway/invalid persisted height can never render a full-canvas card. |
| Calibration is separate from enforcement | `config.ts` | Thresholds, pacing, regex vocab, and slider transformations live in config. |

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

### Sparse-Map Organize Guard

`controller.ts` checks visible map structure, not just candidate richness, before
allowing organize-mode questioning. When the visible map has fewer than three
cards and no connections, organize is blocked: the prompt is told to stay in
carry-forward/clarify mode, and stray organize outputs are rewritten to explicit
next-card capture questions.

### Active Elicitation

The controller records a minimal `activeElicitation` for the latest
carry-forward / failed-mirror / sparse-map-next-card ask. On the next user turn,
that lets code and prompt treat a substantive responsive answer as satisfying the
current ask, biasing toward one grounded mirror attempt instead of another
"which part?" narrowing loop. This is intentionally current-turn scoped; it does
not mine the wider bank for latent intent.

### Direct Map Commands and Provenance

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

Accepted command wording stays in the Source Bank for provenance, but the
controller marks command-consumed current-turn utterances `commandOnly`. Those
utterances are excluded from later LLM bank context so command text cannot come
back as a mirror candidate or Not-quite repair target.

Accepted commands take precedence over same-turn reflection. If a complete
command carries no uncertainty, the coach does not add an interrogative follow-up;
the map acknowledgement carries the action and undo affordance. If the same turn
also expresses uncertainty about another aspect, the command still executes and
the coach may ask about that uncertainty.

### Confirmation Follow-Through

Confirming a mirror chunk writes the user-approved card, then triggers the normal
coach loop against the updated map state so the conversation continues with a
next-step question. The follow-up still runs through `processTurn`; it does not
create a shortcut around readiness, validation, command, or confirmation gates.

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
