# Airtightness Report

Enforcement appendix for `prototype-mindmap`, describing the **Stage 1 typed
proposal runtime** (post-cutover). `DESIGN.md` is the canonical product/design
source and `refactor-plan.md` is the staged plan; this report tracks which
philosophical constraints are enforced in code, which are prompt-level, and
where the residual soft spots are.

> Architecture note: the legacy `controller.ts` regex intent-router, the
> `signals.ts`/`readiness.ts` word-bank readiness gate, and the direct-command
> detection forest described in older versions of this report **no longer
> exist**. `controller.ts` is a thin re-export of the typed loop; `map-commands.ts`
> is a compatibility seam over the action gateway. Enforcement now lives in
> `validator.ts`, `action-gateway.ts`, `proposal-store.ts`, `assistance-contract.ts`,
> `map-store.ts`, and `store.ts`.

## Central Principle

The user controls every committed idea, label, hierarchy, role, and connection.
L0/L1 structure remains user-word-faithful; L2 may contribute visibly attributed
AI suggestions. The model interprets conversational meaning freely; code verifies only facts it owns —
evidence pointers, references, graph integrity, provenance, contract
permissions, and explicit confirmation. Validation gates the AI's contributions;
direct user map actions are never blocked by validation.

## The one enforcement pattern

> Code does not *detect* language. The model *points at* its evidence, and code
> *verifies the pointer is verbatim in the user's text*.

Every consequential act is either fenced by grounding-plus-confirmation,
explicitly AI-attributed plus confirmation at L2, or is a direct user canvas
action. No keyword/regex bank interprets user intent in the enforcement path.

## Code-Enforced Constraints

| Constraint | File(s) | Mechanism |
| --- | --- | --- |
| Reflections and recaps use the user's words | `validator.ts`, `stage1-loop.ts` | Every distinct substantive content word in each claim must be supported by cited eligible evidence; ordinary function-word glue is ignored. Visible text is reconstructed from validated claims rather than trusted from a model-authored wrapper. |
| Relationships/hierarchy are stated by the user in one breath | `validator.ts` | Each cited span must ground `>= 0.75` of its phrase within a *single* utterance. For hierarchy/connection claims, the model declares the literal `relationSpan` connective; code verifies it is a verbatim substring of both the claim text and one cited utterance, and that most claim content words ground in that same utterance. No relation-word bank participates. |
| A reflection is only ever a proposal | `stage1-loop.ts`, `proposal-store.ts`, `App.tsx` | A validated reflection becomes a `shown` proposal with per-claim confirm/decline; only confirmed chunks reach the gateway and become cards. |
| Reflections never carry novel L2 prose | `stage1-loop.ts` | Reflections remain source-backed at every level. L0 is limited to one recorded user moment; L1/L2 cross-turn or draft+chat synthesis is accepted as `ai_connected`. Novel L2 language must use an attributed suggestion or map proposal. |
| Grounded recaps are non-consequential | `stage1-loop.ts` | A recap validates like a reflection, creates no proposal, and may not include candidate upserts. L0 is current-turn-only; L1/L2 synthesis is traced as `ai_connected`. |
| One consequence boundary for every map write | `action-gateway.ts` | `inspectAction` (AI proposals) and `executeCanvasAction` (direct user) are the only paths that mutate the map. Chat, panel buttons, and canvas all route through the gateway. |
| AI card/edit text is verbatim user wording | `action-gateway.ts` | `create_card`/`edit_card` from an AI proposal require the text to be a whole-phrase substring of a cited utterance unless the contract permits AI-suggested structure (then the card is stamped `ai_suggested`, never `user_asserted`). |
| Connections need verified pairing + relationship evidence | `action-gateway.ts` | Below L2, a connection requires a `VerifiedPairingProof` (selection pair, co-mention in one turn utterance, or selection-plus-named-card) *and* relationship evidence grounded in one utterance. The model nominates; code verifies. |
| Explicit nesting intent is honored narrowly | `action-gateway.ts`, `stage1-loop.ts` | A current-turn nesting instruction may support only the named child/parent pair when its exact cited span contains both card references. It still produces a proposal and requires confirmation; no keyword or semantic command classifier is used. |
| References are never guessed into execution | `action-gateway.ts` | Exact normalized match resolves; anything else returns `needs_reference_choice`/`needs_input` for the user to pick. Ambiguity never auto-executes. |
| Missing labels/refs are completed inline, not mined from chat | `action-gateway.ts`, `proposal-store.ts` | Incomplete proposals carry a `completion` and stay `unresolved` (never mislabeled as an AI inference); the next chat message is not treated as a hidden answer. |
| Graph integrity | `map-store.ts`, `action-gateway.ts` | Cycle guard on nesting; connection endpoints normalize to root cards; self-loops dropped; duplicate connections rejected. |
| Proposals cannot execute against a changed map | `proposal-store.ts` | Each proposal stamps `mapRevision`; a moved revision or a vanished referenced card invalidates it. Resolution is by explicit UI transition (`canTransitionProposal`), never by parsing the next message. |
| Contract allowlist is a code gate | `assistance-contract.ts`, `stage1-loop.ts` | `contractRejectsResponse` rejects any response `kind` not allowed at the active level and enforces `optionsMustBeVerbatim`. The contract never authorizes a write. |
| Options at L1 are the user's own words | `stage1-loop.ts`, `action-gateway.ts` | `optionsMustBeVerbatim` requires every option and its spans to be verbatim user spans. |
| Provenance is preserved | `map-store.ts`, `action-gateway.ts`, `proposal-store.ts`, `suggestion-adoption.ts` | `user_asserted`, `ai_connected`, `ai_suggested`, `unresolved`, and `legacy_confirmed` survive persistence. A card that reaches the inclusive 50% suggestion-adoption threshold remains `ai_suggested`; later edits update current/best overlap while retaining the original adoption source and peak. |
| Provider tools transport intent, not authority | `provider-tools.ts`, `api.ts` | The feature-flagged Responses transport exposes only `propose_reflection_v1` and `propose_map_action_v1`; both normalize into the typed union and cross the same gateway/validator/confirmation boundaries. No tool confirms, applies, or persists. |
| Source Bank is ground truth | `store.ts`, `App.tsx` | Chat, declarations, map edits, and immutable draft snapshots are append-only utterances; only the current draft snapshot is model-visible. `commandOnly`/`nonHarvestable` exclude wording from later harvest without deleting provenance. |
| Direct user actions are sovereign and undoable | `action-gateway.ts`, `map-store.ts`, `App.tsx` | `executeCanvasAction` skips AI-only checks (the user is never validation-gated) but still enforces graph integrity; edits/nesting/connections snapshot for undo. |
| Card sizes cannot brick the canvas | `map-store.ts` | `clampCardSize` bounds every `setSize` and every loaded snapshot. |
| Calibration is separate from enforcement | `config.ts` | Only deterministic thresholds and product facts; no language interpretation. |
| Diagnostics describe real events | `stage1-loop.ts`, `understanding.ts`, `trace.ts`, `event-ledger.ts` | Response/validation/gateway/proposal/repair events are emitted from actual outcomes; the local ledger keeps full fidelity, outbound study events carry only allowlisted metadata. |

## Important Code Details

### Mirror validation (`validator.ts`)

Two grounding checks run per claim: **strict content-word grounding** (every
distinct substantive word must occur in cited evidence) and **span grounding**
(each cited span grounds within one utterance; relational claims also require the declared
connective to be verbatim in one utterance). Code no longer classifies epistemic
meaning — the old `tentativeEvidencePattern` word-bank was removed; honoring a
user's tentative framing is the model's judgment. A failed claim yields a
`weakestSpan` for the repair/clarify path.

### The action gateway (`action-gateway.ts`)

`inspectAction` returns a structured result (`ready` / `needs_input` /
`needs_reference_choice` / `needs_relationship_label` / `rejected`), not a
boolean. `ready` carries an `ExecutableAction` and a computed `origin`.
`applyGatewayActions` executes only an already-inspected executable action after
the user's click. `executeCanvasAction` is the parallel boundary for immediate,
explicitly user-authored canvas intents.

### Proposal lifecycle (`proposal-store.ts`)

One `Proposal` type replaces the old pending-command cluster. State transitions
are constrained; `shown`/`edited` are the only actionable states; confirmation is
a UI transition. `mapRevision` stamping makes stale proposals fail closed.

### Assistance contracts (`assistance-contract.ts`)

Three immutable, versioned levels: L0 non-directive (`question`, `reflection`,
`grounded_recap`, `aside`, `map_proposal`; one-moment/current-turn synthesis and
asserted structure only), L1 grounded options (+ verbatim `options` and
cross-turn/draft+chat synthesis traced as `ai_connected`), and L2 suggestive (+
`suggestion` and attributed `ai_suggested` structure). Fixed at every level:
provenance, validation, map-write authorization, confirmation, and graph checks.

### Provider transport (`provider-tools.ts`, `api.ts`)

`chat_json` is the default; `responses_tools` is feature-flagged. Both parse into
the same typed `AssistantResponseEnvelope`. The Responses adapter uses
`store: false`, disables parallel tool calls, and replays provider items only in
the current bounded recovery attempt. Reflection grounding alone may escalate
to a capped forced-question call. Live-turn dialogue history is built call-time
(`historyForCurrentTurn`) so the model never sees a transcript that ends on its
own unanswered question.

## Prompt-Level Constraints

These shape behavior but are **not** the final enforcement boundary:

- the coach philosophy and question rules in `api.ts` (`systemPrompt`)
- sparse-map pacing, reflection rhythm, and turn-shape advisories (all rendered
  as facts, e.g. "cards=N; sparse=true", never as keyword interpretations)
- the Think/Map eagerness value
- the capability manifest (`config.ts`)

Prompt failures are expected to be caught by the validator, the gateway, the
contract allowlist, or the confirmation click wherever an act becomes
consequential.

## Residual Soft Areas

- **Question framing and quotation clarity.** A question can smuggle a suggestion
  or use exact fragments in a syntactically confusing way; no reliable code gate
  catches either. Exact prior-assistant overlap is logged as an `InfluenceTrace`
  (evidence, not an authorship classifier). Reportable evals separately score
  hidden premises and confusing quotation.
- **Near-match resolution** is simple substring/token containment, used only to
  ask the user which card — never to execute structure without confirmation.
- **Candidate grouping / turn-shape** are model-interpreted advisories; bad
  advice is bounded by validation, the gateway, and confirmation.
- **Cross-turn memory / recall is model-owned, code-supported.** The
  `open-threads` subsystem was deleted (2026-07-20) and replaced by working-memory
  recall built on the `CandidateStore`: the model nominates candidates, code
  persists them with a `status` (active/parked/ignored/promoted) and a factual
  `ageInTurns`
  staleness signal (`currentUserTurn` − `lastTouchedTurn`), and the model decides
  when to recall. Held and ignored ideas are surfaced in the Control Room using the
  user's own evidence wording. Code never matches user text to held items or
  decides that the user "returned" to a topic — recall stays a model move, and any
  recalled idea still crosses the gateway before placement. Ignored and promoted
  records absorb model advisory updates; Restore is an explicit user action that
  returns an ignored record to parked.
- **Draft anchoring is model-chosen and passive.** The model may name an exact
  `anchor` substring; `draft-anchor.ts` measures it as a read-only overlay that
  never creates a native selection or mutates the draft. There is no code length
  cap. `findDraftAnchorRange` inserts block/`<br>` separators and matches on
  normalized whitespace, so multi-sentence and cross-paragraph anchors resolve
  (non-contiguous word phrases still fail). Anchor *scope* (short phrase vs.
  passage) remains the model's prompt-level judgment. Opening or undocking the
  draft does not convert a model anchor into user-selected focus.
- **Stemming/normalization** is intentionally simple.

## File Responsibility Summary

| File | Responsibility |
| --- | --- |
| `validator.ts` | Strict content-word + span/relation grounding for reflections and grounded recaps. |
| `action-gateway.ts` | The sole map-write consequence boundary (AI proposals and direct canvas actions), reference/graph/verbatim/pairing checks, origin derivation. |
| `proposal-store.ts` | Proposal type and state machine; revision-stamped invalidation. |
| `assistance-contract.ts` | L0/L1/L2 contracts and snapshots; contribution allowlist. |
| `stage1-loop.ts` | Thin orchestrator: contract check → validate/gateway → proposal; one ordinary repair or a capped reflection-recovery ladder. |
| `store.ts` | Source Bank (ground truth) and Candidate Store. |
| `map-store.ts` | Thought units, nesting, connections, endpoint normalization, sizes, snapshots. |
| `map-commands.ts` | Deprecated compatibility seam re-exporting the gateway. |
| `provider-tools.ts` | Responses-transport schemas and normalization into the typed union. |
| `config.ts` | Deterministic thresholds and product facts (no interpretation). |
| `normalize.ts` | Whole-phrase/word-boundary matching and stemming. |
| `turn-shape.ts` | Deterministic size-only turn classification (advisory). |
| `draft-anchor.ts` | Read-only measurement of a model-named draft anchor span (overlay rects + scroll); never mutates the draft or creates a selection. |
| `event-ledger.ts` | Local full-fidelity events; allowlisted outbound metadata. |
| `api.ts` | Prompt, provider transports, defensive parsing into the typed union. |
| `App.tsx` | Session state, persistence/migration, proposal UI, Control Room, undo, voice, draft. |
| `Map.tsx` | Visual concept map and diagnostics surface. |
| `types.ts`, `llm-contract.ts`, `assistant-response.ts` | Domain and response-contract types. |
