# Reflective Mind-Map Design

This is the canonical design document for `prototype-mindmap`. The companion
`airtightness-report.md` is the enforcement appendix. Older implementation
briefs were removed after they became stale.

## Aim

This is a writing-thinking tool, not a writing-production tool. The user
externalizes their thinking into a concept map. The AI helps by questioning,
reflecting and recapping the user's words, noticing when clarification is
needed, and offering reviewable structure. L0 and L1 remain strictly
user-word-faithful. L2 may originate visibly attributed suggestions, but no
model contribution becomes map structure without explicit user confirmation.

The central bet is that constrained dialogue plus a user-grounded external map
helps a person construct and recognize their own thinking more deeply than
freeform chat or AI-generated prose.

## Invariants

1. **The user controls every committed idea, label, hierarchy, role, and
   connection.** Direct user structure is user-authored; confirmed L2 material
   retains visible AI provenance.
2. **L0 and L1 never author ungrounded structure.** L2 may suggest new content or
   structure only with explicit attribution and the same confirmation gateway.
3. **Validation gates the AI, never the user.** The map is the user's sovereign
   workspace.
4. **Selection creates influence.** Model-chosen connections among the user's
   words are recorded as `ai_connected`; AI-authored wording is recorded as
   `ai_suggested`. Neither is disguised as purely user-authored.
5. **The slider moves eagerness, never the authorship gate.**
6. **Enforcement lives in code; calibration lives in config.**

Useful corollary: the AI may interpret freely, but a consequential act that
creates structure is either source-grounded and confirmed, explicitly
AI-attributed and confirmed at L2, or a direct user action.

## Required Behavior

### Capture

A large voice/text turn is split into sentence-level units. Each unit is recorded
verbatim in the Source Bank. Nothing the AI says is ever treated as the user's
words. The typed turn orchestrator supplies factual context about a long,
exploratory turn so the model can choose an appropriate focusing move; it does
not classify the user's intent or rewrite the model's language.

### Questioning

The coach makes one coherent move per turn. That move may be a question,
reflection, grounded recap, aside, options, suggestion, or map proposal when the
active assistance contract permits it. Questions must not smuggle an unstated
answer, relationship, or direction into their premise. Direct quotation is used
only when it makes the question clearer; exact but confusing fragments are not a
quality success.

### Mirroring

A mirror restates structure in the user's own words. Its visible text is derived
from validated claims, so an uncited model-authored wrapper cannot leak into the
proposal. At L0 it draws from one recorded user moment; at L1/L2 it may bring
together eligible wording across turns or chat plus the current draft snapshot,
and that model-chosen synthesis is recorded as `ai_connected`. A mirror is split
into confirmable chunks; only confirmed chunks become cards.

Reflection-grounding failures use a named, capped recovery ladder: initial
response, one informed repair supplied with the rejected reflection and exact
unsupported words, and—only if the repair is another grounding-failed
reflection—one forced-question call. The third call accepts only a valid typed
question. All other rejection paths retain one repair call. There is never a
fourth model call; exhausted paths render application-owned recovery UI.

### Grounded Recaps

A grounded recap is conversational consolidation, not a map proposal. Its
visible text is derived from validated, source-backed claims and it cannot
nominate candidate structure. L0 recaps only the current user turn. L1/L2 may
synthesize eligible user wording across turns or juxtapose chat with current
draft wording; cross-source or cross-turn selection is recorded as
`ai_connected`. Novel L2 interpretation belongs in an attributed suggestion,
not in a recap.

### Carry-Forward

When the user explicitly commits an idea ("the main idea I want to carry forward
is X"), a single clear, grounded statement can mirror immediately. It still must
validate and still requires confirmation. This fast-track is honored at any
slider position.

### Chat-Derived Map Changes

The model decides whether a chat turn warrants a map proposal; code does not
infer an imperative from wording. Every chat-derived structural change is shown
as a proposal and requires an explicit click before it can mutate the map.
The action gateway verifies user wording, references, duplicates, and graph
integrity. Missing labels and ambiguous references are completed in the proposal
card, never by parsing a later chat turn. A current-turn instruction that
explicitly names both cards in a nesting action may support that exact nesting:
the model cites the complete instruction, code verifies the span, recency, and
both references, and the user still confirms. Code does not infer this intent
with keywords or a semantic command parser.

The composer has an explicit "Add as card" affordance for intentional capture.
Direct canvas manipulation remains immediate because it is already an explicit
user action, but it still crosses the same integrity boundary.

### No Harvesting

For long/exploratory turns, the coach must not extract a fixed number of cards.
It mirrors only what the user explicitly selected or grounded clearly enough;
otherwise it asks one focusing question that hands selection back to the user.
The longer and richer the input, the more careful the coach must be about
selecting structure for the user. The model receives factual turn-shape advice
and asks a focusing question when it cannot ground a clear proposal. Code never
uses turn shape to author, suppress, or rewrite conversational content.

### Sparse-Map Pacing

When the visible map is still sparse, the coach should keep helping the user
capture ideas rather than prematurely asking them to organize relationships.
Visible candidate richness alone is not enough to justify organize-mode
questioning. Until the map has enough structure to compare or connect, code
supplies a factual sparse-map pacing advisory asking the model to prefer capture
or clarification. This is deliberately prompt-advised rather than a controller
rewrite: pacing is a conversational judgment, not an authorship or safety gate.

### Draft Context and Focus

The complete draft is background context; a real user selection is stronger,
explicit focus evidence. The model uses the request, recent dialogue, and draft
to judge whether a passage-specific move is useful. A model-chosen anchor is a
passive overlay, never a browser-native selection and never `selectedFocus`.
`View passage`, or reopening the draft after it was docked/minimized, reveals and
scrolls to the anchor without changing its authorship status.

Draft evidence is stored as immutable snapshots. Only the current snapshot is
model-visible. L0 cannot cite draft wording in reflections or recaps; L1/L2 may
juxtapose it only with eligible chat wording, and the result is `ai_connected`.

### Controlled Working Memory

Candidate ideas are deterministic lifecycle records (`active`, `parked`,
`ignored`, `promoted`) backed by exact Source Bank evidence and user-turn ages.
The model decides whether recall is conversationally useful; code does not match
topics or impose a minimum age. Recall is limited to validated questions and
asides using exact user phrases. Ignore and promotion prevent model
resurrection; Restore is an explicit Control Room action that returns an idea to
parked. Recall UI and terminal recovery UI never enter provider history or the
Source Bank.

### Provenance and Suggestion Adoption

User-authored material has no prominent badge. Model-selected synthesis of the
user's words is shown as `AI-connected · your words`. L2-originated structure is
shown as an AI suggestion. If a card's distinct stemmed content words overlap a
visible prior suggestion by at least 50% on creation or edit, it becomes
persistently `ai_suggested`; later edits update its current percentage and peak
without laundering the original influence. Suggestions that occur after the
card text was established cannot retroactively claim adoption.

### Sovereign Map

The user can freely create, edit, drag, nest, connect, delete, and undo. No map
action is blocked by reflection validation. User-introduced wording writes
back to the shared Source Bank so later AI turns stay grounded in the user's
canvas work.

### Slider

The Think-to-Map slider changes eagerness and pacing for non-declared ideas. It
is passed to the model as explicit factual steering. Honoring a user's tentative
framing is now the model's judgment, not a code word-bank: code no longer
classifies uncertainty from wording. The slider never changes pointer grounding,
confirmation, or whether chat-derived proposals require explicit confirmation.

### Diagnostics

The Control Room shows the trustworthy typed-response, validation, repair,
gateway, proposal, and application events for the current session. It does not
invent explanations from a legacy controller mode.

## Implementation Map

| Behavior | Where | Mechanism |
| --- | --- | --- |
| Capture | `store.ts`, `normalize.ts` | `SourceBank.addSegmented`, sentence/newline segmentation |
| Questioning | `api.ts`, `stage1-loop.ts`, `llm-contract.ts` | Typed response prompt plus factual, advisory turn/map context |
| Validation | `validator.ts` | Strict visible-word grounding + span/relationship grounding for reflections and recaps |
| Confirmation | `App.tsx`, `proposal-store.ts` | Reflections and map actions remain inert until an explicit proposal decision |
| Chat proposals | `stage1-loop.ts`, `action-gateway.ts` | Model proposes; code verifies pointers/references; user confirms |
| Direct canvas actions | `Map.tsx`, `action-gateway.ts` | Immediate explicit-user actions retain graph/store checks |
| Assistance contracts | `assistance-contract.ts`, `stage1-loop.ts` | L0/L1/L2 contribution permissions are snapshotted per turn; they never authorize a write |
| Provenance | `proposal-store.ts`, `map-store.ts`, `suggestion-adoption.ts`, `Map.tsx` | User-authored, AI-connected, and AI-suggested material remain distinguishable; adopted suggestions retain current and peak overlap |
| Audit ledger | `event-ledger.ts` | Full local events in IndexedDB; no server telemetry |
| Map | `map-store.ts`, `Map.tsx` | One primitive: `ThoughtUnit` card; nesting is `parentId`; connections have label cards |
| Draft grounding and anchoring | `App.tsx`, `api.ts`, `draft-anchor.ts` | Immutable current draft snapshots plus a passive model anchor overlay; model anchors never create `selectedFocus` |
| Voice dictation | `App.tsx`, `useSpeechToText.ts` | Browser speech recognition fills the composer for manual review before send |
| Slider | `config.ts` | `withQuestionIntentBias` changes pacing thresholds only |
| Diagnostics | `understanding.ts`, `trace.ts`, `Map.tsx` | Structured response, validation, repair, gateway, proposal, and application events |
| Provider proposal tools | `provider-tools.ts`, `api.ts` | Feature-flagged Responses tools normalize into the same reflection/map-proposal path and never mutate the map |

The integration that must never break: the map and the chat loop share the same
`SourceBank` instance (`stateRef.current.bank`). Map writes and undo restores go
through that instance.

## Decisions and Rejected Alternatives

- **LLM interpretation, code fences.** The model interprets conversational
  meaning and decides whether to ask, reflect, or propose. Code verifies only
  facts it owns: evidence pointers, references, graph integrity, provenance,
  contract permissions, and explicit confirmation.

- **Factual advice, not lexical interpretation.** Code may tell the model facts
  such as the current map is sparse, the user selected a card, or a draft span is
  in focus. It does not feed keyword/regex interpretations such as "because was
  detected" back into the prompt, and it never rewrites a capable model's
  conversational response merely to enforce pacing.

- **No controller trim for mirror chunk count.** A hard cap would silently drop
  user-grounded claims and move selection into code. If many ideas are ready,
  ask a focusing question; do not trim.

- **Declaration recognition is not slider-gated.** Explicit user intent is
  honored at any position. The slider only tunes pacing for non-declared ideas.

- **Carry-forward is idea-only.** It accelerates density only. It never satisfies
  relationship clarity, hierarchy spontaneity, or connection grounding.

- **Proposal-first chat structure.** Chat is never a direct mutation channel,
  even when its wording appears imperative. The proposal click supplies the
  intent confirmation that evidence checks cannot infer.

- **Provider tools transport intent, not authority.** The Responses transport
  exposes only reflection and map-action proposal tools. Calls normalize to the
  existing typed union and still cross contract, evidence, gateway,
  confirmation, and revalidation boundaries. There is no provider tool for
  confirmation, application, direct canvas mutation, or persistence.

- **Local transcript remains authoritative.** The Responses adapter uses
  `store: false`, disables parallel tool calls, and replays provider items only
  inside the bounded recovery attempt currently in flight. Reflection grounding
  alone may use the capped third forced-question call. `chat_json` remains the
  default until `responses_tools` matches or improves validity and passes a live
  propose-only authority smoke test.

- **No ghost structure.** An AI proposal is reviewed in chat only. It never
  stages a tentative card, edge, nesting, layout shift, or relationship visual
  on the canvas before the user confirms it.

- **Narrow L0 claim.** L0 ensures that map structure is user-stated,
  deterministically grounded, and explicitly confirmed; it does not claim that
  a question could never influence a user's subsequent wording. Exact prior-turn
  echo is logged as influence evidence, not misrepresented as authorship proof.

- **Inline proposal completion.** Missing labels and ambiguous references are
  resolved in a proposal card. The next user message is never treated as a
  hidden yes/no, correction, or command continuation.

- **Nested cards render as embedded DOM, not xyflow subflows.** This keeps the
  card as the one primitive and makes nesting visually literal.

- **Default model profile.** The prototype starts with GPT-5.6 Terra at low
  reasoning. Comparative profiles remain an evaluation decision after the live
  transcript smoke test; no model is judged on a harness that omits the latest
  user reply from dialogue position.

- **Eval rubric: mirror within about one productive turn.** One useful follow-up
  on a compound idea is a pass; forcing immediate mirroring everywhere would
  make the tool an extractor.

## Current Status

Built and tested:

- capture/segmentation
- typed question/reflection/grounded-recap/aside/map-proposal/options/suggestion responses
- pointer validation and attribution derivation
- visible reflection/recap text derived from validated claims
- per-chunk mirror confirmation
- reflection-specific informed repair and forced-question recovery, with
  application-owned terminal UI
- proposal-first chat structure and direct canvas integrity actions
- explicit current-turn card-reference nesting intent without semantic routing
- concept map cards, nesting, connections, delete, undo
- immutable draft snapshots and passive draft anchoring
- Think-to-Map slider
- structured diagnostics
- controlled working-memory candidate lifecycle and source-backed recall
- three-tier provenance plus persistent suggestion-adoption percentages
- browser voice dictation into the chat composer with manual review before send
- persisted contracts, provenance, local ledger, and v6 session migration
- command-only exclusion from mirror eligibility

Current verification checkpoint (2026-07-21): TypeScript and eval type-checks,
270 Vitest tests, and the production build are green. Browser smoke verified the
application shell and assistance-level switching. Live-model recap, explicit
nesting, and tuned reportable-eval verification remain the next evidence pass.

Known tradeoff: questions can still carry framing that code cannot reliably
classify. The system protects autonomous map authorship, provenance, and visual
staging in code; it records exact echo evidence and measures conversational
directiveness through scenario evaluation rather than brittle language routing.
