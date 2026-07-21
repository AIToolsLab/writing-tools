# Refactor Plan: De-Brittle, then Assistance Contracts

Status: Stage 1 implemented 2026-07-15. A required Stage 1.5 conversation-context
stabilization pass precedes Stage 2 and the GPT-5.6 bakeoff.
Companion to `DESIGN.md` (canonical invariants) and `airtightness-report.md`.

Stage 1 landed as a hard cutover: the live app consumes the typed response union,
uses one persisted proposal lifecycle for reflections and map actions, performs
a bounded structured recovery, and routes chat confirmations and direct canvas
intents through the action gateway. Legacy routing/fallback tests were replaced
with response, gateway, proposal, and repair contract tests.

## Next implementation pass - recovery and draft-focus stabilization (locked)

This is the next runtime pass. It is deliberately separate from LiveKit, model
bakeoffs, and further provider-tool optimization.

### Reflection recovery

- Keep one repair call for every rejection except reflection grounding. A
  grounding-failed reflection may make one informed repair attempt and, only if
  that attempt is another grounding-failed reflection, one final forced-question
  call. The hard cap is two reflection attempts and three model calls total.
- Tell the repair model declaratively: when a requested reflection cannot be
  repaired faithfully, briefly acknowledge uncertainty in natural language and
  make one context-specific move using established conversation content. It must
  not expose validation terminology, repeat a recent question, or use stock
  recovery phrasing. Do not include polished fallback examples in the prompt.
- Supply the structured rejection, the rejected typed payload, recent assistant
  turns, and currently available grounded material to the repair call.
- Questions and asides do not undergo reflection-pointer validation. They still
  pass response parsing and the active assistance-contract allowlist.
- If the bounded recovery is unusable - malformed or still rejected by its
  applicable checks - do not make another model call and do not silently render
  nothing. Show a minimal transparent application recovery with a retry
  affordance. This is terminal UI state, not a fabricated coach turn.
- Remove the active `tentativeEvidencePattern` semantic classifier, including
  the rule that treats every "I think" as uncertainty. Interpreting uncertainty
  belongs to the model; code continues to verify cited text and consequential
  actions rather than infer epistemic meaning from a word bank.
- Update diagnostics to describe the actual result. Remove the stale instruction
  to "fall back to a clarifying question" when no such controller fallback runs.
  `waitingFor` may describe proposal completion only when an active proposal
  genuinely requires user input; a repair request alone must not create it.

### Draft focus interaction

- Move `Ask about this` out of the crowded composer toolbar and into a compact
  contextual control positioned above a real user-created draft selection.
- Preserve model-provided read-only draft anchoring, but stop representing it as
  the browser's native blue selection. Use a passive highlight that does not
  become user-selected focus, alter draft content, or interfere with editing.
- Keep `View passage` as the explicit reveal/scroll affordance. Prompt advice
  should make draft anchors selective rather than routine, without a code rule
  that interprets when a passage is semantically necessary.

### Open-thread quarantine

- The current discourse-marker splitter in `open-threads.ts` is not part of the
  live turn path. Do not reactivate it as an interpretation layer. Before the
  subsystem returns to live orchestration, replace marker-based semantic
  inference with model-nominated exact spans and deterministic pointer checks.

### Non-goals and preserved invariants

- No LiveKit work in this pass.
- No second repair call, canned coach fallback, forced Map proposal, regex
  routing, chat yes/no proposal resolution, or direct model map mutation.
- Think/Map remains prompt advice. Assistance contracts, provenance, explicit
  proposal confirmation, no-ghost-structure, and the action gateway remain
  unchanged.

### Required regression evidence

- A rejected reflection can repair into a valid question or aside and render it.
- Repair receives the rejected payload, structured reason, grounded material,
  and recent assistant turns; it still runs at most once.
- An unusable repair ends loading and displays transparent retry UI without an
  invented coach response.
- Conversational "I think" no longer triggers code-level uncertainty
  classification.
- Model anchors never create native selection or `selectedFocus`; genuine user
  selections can invoke the floating `Ask about this` control.
- Control Room waiting/recovery text matches actual proposal and repair state.

## Stage 1.5 — Conversation-context stabilization (required)

**Why this is a prerequisite:** the first hard-cutover implementation captures
the current turn in the Source Bank, but the in-flight
provider closure can still receive dialogue history ending on the preceding
assistant question. That makes model and contract evaluation invalid: a model
is being asked to respond to a conversation in which its question appears
unanswered.

**Decision:** repair missing or stale *factual context* without reintroducing
code interpretation of language. Code must not use regex/keyword outputs to
tell a capable model what a user's wording means, or rewrite the response it
chooses. It may supply facts it owns: dialogue ordering, map sparsity, selected
cards/draft text, explicit UI requests, capabilities, and measured turn size.

### 1.5.1 — Call-time dialogue history

- Build each provider call from the committed transcript plus the current user
  message synchronously in `send`; the current dialogue history must end in
  that user message exactly once.
- Remove the long-lived transcript closure as durable conversation state. Keep
  repair-local history so the one repair request still sees its rejected
  assistant response, alongside the structured rejection supplied in the
  system context.
- Apply the same call-time construction to Under-the-Hood requests and reset
  paths. Drop the redundant foregrounded `LATEST USER TURN` prompt section once
  the dialogue turn is present; Source Bank entries remain available for
  evidence pointers.

### 1.5.2 — Honest, minimal prompt advice

- Restore and render only factual advisory inputs: sparse-map pacing, selected
  focus, explicit UI support request, the Think/Map control, capability manifest,
  raw draft text, measured turn size, candidate evidence memory, and parked threads.
- Prioritize selected focus and explicit UI requests: they are visible controls
  and must reach the model. Sparse-map pacing is next, as a prompt advisory to
  favor capture/clarification on an empty map.
- Do **not** render `detectedSignals` or other keyword/regex interpretations.
  They neither authorize actions nor tell the model what a user's words mean.
- Delete context fields that are neither populated nor rendered so the prompt
  contract cannot silently drift.

### 1.5.3 — Regression evidence and gate

- Add a transcript fixture for the reported unanswered-question/anaphora case.
  Assert role ordering, exact inclusion of the newest user turn, absence of the
  redundant latest-turn field, and repair-local rejected-response context.
- Add prompt-context tests for selected focus, explicit support request,
  sparse-map advice, capability truth, measured turn size, and raw draft text.
- Add the normalized whole-phrase regression (`under` must not match
  `underrated`) to the preserved evidence suite.
- Run the reported transcript as a manual smoke test. Do not start live model
  comparison or assistance-contract evaluation until these assertions and the
  smoke test pass.

## Why

The current loop is effective at the philosophy but not practically usable. The
brittleness is not in the philosophy and not in the enforcement core — it is in
three specific places:

1. **The pending-state cluster.** `LoopState` (controller.ts:147) carries ~10
   interacting mutable fields. `processTurn` is ~1,800 lines of early-return
   branches, each manually clearing its own ad-hoc subset. Forgetting one field
   in one branch is the dominant bug class.
2. **The word-bank NLU layer.** `STUCK_PHRASES`, `isAffirmative`/`isNegative`,
   `detectCoverageIntent`, `FOCUS_HELP_PATTERNS`, the imperative-verb regexes,
   `RELATION_TERMS`/`CONTAINMENT_TERMS` in the enforcement path. Code doing
   interpretation, in an implicit priority order, competing with the model's own
   interpretation of the same turn. Two interpreters that can disagree.
3. **Canned recovery prose.** `focusedDeepenFallbackQuestion`, `nextStepQuestion`,
   `coverageAnchorQuestion` etc. — the direct source of stale/repetitive coach
   wording.

The enforcement core (`validator.ts`, `map-store.ts` invariants, SourceBank
provenance, reference resolution, user confirmation) is sound and mostly
survives untouched. It checks **proposed actions against ground truth the code
owns**, which is why it doesn't need to understand English.

## The one pattern

> **Don't ask code to *detect* language. Ask the model to *point at* its evidence,
> and have code *verify the pointer is verbatim in the user's text*.**

The model does interpretation (what it's good at) and declares what it relied on.
Code does a string comparison it can't be talked out of. The gate stays
deterministic; the word banks all go away.

Already true of: `create_card(text, sourceUtteranceIds)` requiring `text` to be a
verbatim substring of the turn.

Applies next to: relation assertion (see 1.0), stuck/affect/intent detection
(1.5), command recognition (1.4).

## Target pipeline

```
User input
  → source/provenance capture (SourceBank — unchanged)
  → model returns a typed AssistantResponse (discriminated union)
  → contract check: is this response `kind` allowed at the current level?
  → code verification: grounding / verbatim / reference / graph checks
  → UI presents any consequential proposal
  → user confirms / edits / declines
  → ONE action gateway mutates the map and emits an audit event
```

The controller becomes a thin orchestrator. It is not an English parser.

## What survives vs. what dies

**Survives essentially unchanged:**
- `validator.ts` — grounding checks (one addition, see 1.0)
- `map-store.ts` — cycle checks, root-endpoint normalization, duplicates
- `store.ts` — SourceBank, provenance, `commandOnly`
- `normalize.ts`, `map-layout.ts`, `Map.tsx`, `map-commands.ts`
- reference resolution logic (relocated into the gateway, logic intact)
- `understanding.ts` / UTH (gains better events to show)
- `open-threads.ts`

**Dies:**
- the regex intent router in `controller.ts` (~most of the top 3,000 lines)
- all canned fallback question builders
- 4 pending-command types + `isAffirmative`/`isNegative`/`awaitingCorrection`
- `RELATION_TERMS`/`CONTAINMENT_TERMS` **in the enforcement path** (they stay in
  `signals.ts` for readiness scoring — that's calibration, brittleness is cheap there)
- most of `loop.test.ts` (266KB, coupled to exact strings and branch order)

**Current cutover note:** the remaining `signals.ts`, `readiness.ts`, and
draft-declaration regexes were also removed during Stage 1.5. Candidate evidence
may remain as memory, but no synthetic readiness label, keyword detector, or
declaration detector feeds model context; raw user wording and factual UI state
are the only advice.

---

# Stage 1 — De-brittle

Each step is independently landable, testable, and commit-sized. **Land the
seams (1.1, 1.2) before the deletions (1.4, 1.5, 1.6).**

## 1.0 — Pointer-verified relation assertion

Smallest, self-contained, proves the pattern. No controller changes.

**Problem being fixed:** `claimRelationStatedInOneUtterance` (validator.ts:143)
requires the cited utterance to contain a term from a hardcoded 20-word list
(line 156). So *"transparency undergirds human control"* — asserted, in one
breath, in the user's own words, both endpoints present — is **blocked**, because
"undergirds" isn't in `RELATION_TERMS`. The user gets a clarifying question about
structure they just clearly stated. Note also the stemming asymmetry: content
tokens go through `stem()`, but relation terms are matched raw, so "support"
does not match `supports`.

This word bank is currently load-bearing for the maieutic claim. It is both too
narrow to serve users and too arbitrary to defend to a reviewer.

**Change:** `MirrorClaim` gains a declared `relationSpan`:

```ts
interface MirrorClaim {
  // ...existing
  /** Required when target is "hierarchy" | "connection". The model names the
   *  user's own connective it is relying on. */
  relationSpan?: { utteranceId: string; text: string };
}
```

Code checks (no language understanding, no list):
1. `relationSpan.text` is a verbatim substring of `claim.text`
2. `relationSpan.text` is a verbatim substring of `bank.get(relationSpan.utteranceId).text`
3. both endpoints grounded in **that same utterance** — existing
   `spanGroundedInSingleUtterance`, unchanged

Pass → claim is `asserted`. Fail → claim is `inferred`.

**Why this is stricter, not looser:** today's bar is "some listed term appears
somewhere in the cited utterance." The new bar is "the exact connective you are
claiming is in this utterance, and you named it up front." The model cannot cite
a connective that isn't literally there, and cannot use a connective in the claim
that it didn't cite. If the user said "matters", the model cannot claim
"supports" — check 2 fails.

**Files:** `validator.ts`, `llm-contract.ts`, `api.ts` (prompt + parse), `validator.test.ts`.

**Verify:** existing validator tests must still pass. Add: "undergirds" passes;
cross-utterance stitch fails; claim-connective-not-cited fails; cited-connective-
not-in-claim fails.

## 1.1 — Action gateway (pure extraction, no behavior change)

Extract every map mutation path into one module, `action-gateway.ts`, with the
deterministic checks inside it:
- verbatim substring of turn
- reference resolution (exact / unique-near / ambiguous)
- cycle check, root-endpoint normalization, duplicate detection

Everything — chat, UTH buttons, direct canvas actions — routes structure writes
through it. Direct canvas actions call it in a mode that skips AI-only checks
(the user is sovereign; validation gates the AI, never the user).

This is the seam everything else hangs on. No behavior change; existing tests
should pass as-is.

**New:** the gateway returns a **structured result**, not a boolean —
`{ ok: true, event } | { ok: false, reason: MachineReadableReason, detail }`.
That result is what later steps feed back to the model instead of canned prose.

## 1.2 — Proposal lifecycle (replaces the pending-state cluster)

One `pendingInteraction`, not four pending types.

```ts
interface Proposal {
  id: string;
  mapRevision: number;         // stamped at creation
  referencedCardIds: string[];
  action: ProposedAction;
  attribution: "asserted" | "inferred";   // computed by code, never model-claimed
  state: "shown" | "confirmed" | "edited" | "declined" | "cancelled" | "invalidated";
}
```

- Invalidates automatically when `mapRevision` moves incompatibly or a
  referenced card disappears. This deletes the entire stale-pending-command path.
- Resolved by **UI click**, never by parsing the next message. `isAffirmative`,
  `isNegative`, `isCancel`, `awaitingCorrection` all die here.
- A new user message does not need to resolve it. The conversation continues; the
  proposal stays actionable or is dismissed.

**Behavior change:** confirmations become clicks. This is the highest-leverage
single change in Stage 1.

## 1.3 — Typed response union

Replace the `LLMTurn` mega-object with a discriminated union. Most turns are not
tool calls — reserve actual tools for consequences.

```ts
type AssistantResponse =
  | { kind: "question"; text: string; stance: QuestionStance; anchor?: string }
  | { kind: "reflection"; text: string; claims: MirrorClaim[] }
  | { kind: "options"; text: string; options: VerbatimSpan[] }   // gated: L1+
  | { kind: "suggestion"; text: string; suggestions: Suggestion[] } // gated: L2+
  | { kind: "aside"; text: string }
  | { kind: "map_proposal"; text: string; action: ProposedAction };
```

`kind` is the enforcement surface for contracts in Stage 2 — code checks the
allowlist, no prompt trust required. Build the union now even with all kinds
enabled; the contract is just an allowlist over it later.

## 1.4 — Proposal-first for chat-derived structure

**Decision already made:** chat-derived structure is always a proposal until the
user clicks it.

**Rationale (this is the load-bearing argument, keep it):** code can verify
*provenance* (is this text verbatim the user's words?). Code cannot verify
*intent* (did the user mean to place it?). "Selection is authorship" is an intent
invariant. A model false-positive on *"I could put human control on the map"*
would otherwise produce a card made of the user's own words that the user never
chose to place — verbatim-grounded, provenance-clean, and still an authorship
violation. Nothing in code closes that gap. A click does.

Deletes: `looksLikeDirectCommand`, `isImperativeConnectCommandText`,
`isImperativeNestCommandText`, `EXACT_TEXT_MARKERS`, `cleanExplicitCardText`,
`UNCERTAIN_COMMAND_FRAME`, `hasStructuralNegation`, `isNegatedImperativePrefix`,
`commandVerbReadsImperative`, `detectStructuralVerbIntent`, and the rest of the
command-detection forest. The model decides "is this a map proposal"; the gateway
verifies verbatim + references; the UI chip carries the click.

**Cost to acknowledge:** every card is now two acts. Mitigate with a composer
affordance ("Add as card") for deliberate speed — an explicit UI action, not an
inferred natural-language exception.

## 1.5 — Delete the intent regexes

All of these become model-supplied context fields, none of them gate authorship:
`STUCK_PHRASES`, `DRAINED_PHRASES`/`seemsDrained`, `detectCoverageIntent`,
`FOCUS_HELP_PATTERNS`, `looksLikeTopicPivot`, `looksLikeSubstantiveAnswer`,
`detectOpenThreadRecallIntent`, `isStaleFocusFamilyQuestion`,
`detectTypedModeOverride`, `questionConceptOverlap`.

Keep as **calibration only** (advisory input to the model, never a gate):
`turn-shape.ts`, `readiness.ts`, `signals.ts`, sparse-map signal.

## 1.6 — Structured errors replace canned prose

When a gate fires, return the gateway's machine-readable reason **to the model
in-turn** ("claim 2 failed relation assertion: connective 'supports' not present
in utterance u17"). The model re-emits or asks its own honest question. Ordinary
rejections remain bounded to one repair round. Reflection grounding alone may
escalate through the capped informed-repair/forced-question ladder before honest
application-owned recovery.

Deletes every `*FallbackQuestion` builder. Validation failure stops being a
controller state transition and becomes a tool error the model handles
conversationally.

## 1.7 — LoopState collapse

Target: ~15 fields → ~7, one pending thing.

**Keep:** `bank`, `draft`, `turnsSinceLastMirror` (pacing), transcript
(replaces `lastAiText`/`prevAiText`), `pendingInteraction`, `openThreads`,
`dismissedCandidateIds`.

**Delete:** `pendingMapCommand`, `organizeFocus`, `coverageFocus`,
`pendingChildPlacement`, `activeElicitation`, `activeSelectionContext`,
`pendingCardWording`, `captureLoop`, `clarifyTarget`, `lastCoachQuestion`,
`mode`. All are either transcript-derivable (the model tracks its own thread) or
UI-supplied per-call options.

**Open question — see Decisions below:** does `CandidateStore` survive? Once
readiness is calibration rather than a gate, its job shrinks considerably.

## 1.8 — Test restructure

Stop testing branch order and exact fallback wording. `loop.test.ts` is largely a
write-off; `fuzz.loop.test.ts` is the model to follow.

- **Unit:** validator, provenance, reference resolver, map invariants, proposal
  lifecycle, contract capability matrix
- **Gateway contract tests:** no map mutation without confirmation; no
  non-verbatim text becomes user-authored; stale proposals cannot execute;
  cycles/unresolved refs fail safely
- **Property/fuzz:** arbitrary sequences of messages, clicks, cancels, deletes,
  undo, reload never violate invariants or wedge a pending interaction
- **UI e2e:** proposal chips, edit/confirm/decline, persistence, attribution

**The invariant spine (these must never fail):**
1. No card exists without user confirmation or an explicit user canvas action.
2. No card text that isn't verbatim user words.
3. No reflection shown that fails the validator.
4. No `inferred` structure at L0.
5. No proposal executes against a map revision it wasn't created for.

---

# Stage 2 — Assistance contracts

Lands nearly free on top of 1.3: a contract is an allowlist over response `kind`,
plus the `attribution` field from 1.0/1.2.

**Locked product decisions for this phase:** ship three public levels (0-2),
default every new session to non-directive, permit logged mid-session changes,
and keep the Think-to-Map slider separate. Use a same-map provenance badge for
AI-originated material rather than a separate visual layer. Keep model selection
developer-only, default to GPT-5.6 Terra at low reasoning, and persist a local
full-fidelity event ledger while mirroring only sanitized metadata to the study
log endpoint.

**Stage 2 boundary:** do not add Responses API work or provider tools here. The
typed response plus deterministic gateway already provides a safer consequence
boundary. Revisit read-only tools only when local traces show a concrete
context-retrieval failure.

**Fixed at every level — never varies:** provenance, validation, verbatim
requirements, map-write authorization, confirmation, reference and graph checks.
The contract varies *only* what the AI may contribute.

## Two-level shape (comparison only; not selected for this build)

| Level | Allowed kinds | AI may... |
|---|---|---|
| **0 — Non-directive** | `question`, `reflection` (asserted only), `aside`, `map_proposal` (asserted only) | reflect structure the user asserted; ask; clarify |
| **1 — Suggestive** | + `options`, `suggestion`, `reflection`/`map_proposal` with `inferred` | originate structure and content, visibly AI-attributed with persistent same-map provenance |

Binary and sharp: **does the AI ever originate structure, or not.** This is the
cleanest research contrast and the easiest to explain at a poster.

## Three-level shape (recommended)

| Level | Adds | Code-enforceable boundary |
|---|---|---|
| **0 — Non-directive** | `question`, `reflection` (asserted), `aside`, `map_proposal` (asserted) | every claim passes assertion grounding; `inferred` rejected at the response gate |
| **1 — Grounded options** | + `kind: "options"` | **every option must be a verbatim span of user material.** AI may select and juxtapose the user's own words; it may not originate |
| **2 — Suggestive** | + `kind: "suggestion"`, `inferred` structure | no verbatim requirement, but attribution + same-map provenance badge enforced; promotion preserves origin |

The reason 3-level is worth it: **each boundary is a real code check, not a
prompt vibe.** L0→L1 is "may the AI direct attention by juxtaposition?" — enforced
by requiring options to be verbatim spans (the same pointer-verification pattern).
L1→L2 is "may the AI originate?" — enforced by the `attribution` field. L1 costs
almost nothing once L0 and L2 exist.

**Recommendation:** build 3; for a *study*, run L0 vs L2 as the conditions and
treat L1 as a product/demo affordance. Six levels would be six prompt variants,
six eval suites, and blurred conditions — and I doubt the model can hit six
distinct rungs of directiveness reliably.

## Contract object

Versioned and immutable:

```ts
{
  id: "grounded-options-v1",
  level: 1,
  allowedKinds: ["question", "reflection", "aside", "map_proposal", "options"],
  allowedAttribution: ["asserted"],
  optionsMustBeVerbatim: true,
  mapWritePolicy: "user_confirmation_required",
  provenancePolicy: "user_authored_only",
  promptFragment: "...",
  pacing: { /* absorbs Think-to-Map deltas if 3.2 concludes it should */ }
}
```

## Attribution and the maieutic claim

At L2, AI-originated material **must not masquerade as user-authored**. It lives
on the same map with a persistent visible origin badge; the user can quote,
adapt, or promote it, and the promotion event preserves provenance. Otherwise a
suggestive setting quietly breaks the product's central claim.

The claim L0 can then support, falsifiable from the event log:

> In non-directive mode, map structure is explicitly stated by the user,
> grounded in their wording, and confirmed by them. The system contains no code
> path by which an AI-inferred relation can become map structure or be visually
> staged on the map before confirmation.

**Honest residue — state this in the paper rather than let a reviewer find it:**
- *Selection.* Even a pure reflection involves the AI choosing which asserted
  structure to surface now. Bound it (reflect only current-turn or selected-strand
  structure) and log it. But selection is not authorship — a Socratic tutor also
  chooses what to reflect. Make the smaller claim precisely: "the AI does not
  author structure," not "the AI has no influence."
- *Framing inside questions.* A question can smuggle a suggestion; no code check
  catches it. Exact prior-assistant overlap is logged as influence evidence, but
  it is not a reliable authorship classifier. Only Stage 4 evals address this.

**UI language:** do not call a reflection a "proposal." An `asserted` chip says
*"Here's the structure in your words — check each part"* (already `MIRROR_PREAMBLE`).
An `inferred` chip is visibly AI-attributed. Same lifecycle, different label, and
the label is earned by a code check.

---

# Stage 3 — Session report

Stage 2 establishes the event ledger. Stage 3 turns it into a human-readable,
downloadable transparency artifact rather than analytics:

`assistance_contract_selected`, `user_message`, `assistant_response`,
`proposal_created`, `proposal_resolved`, `map_mutated`, `contract_changed`

Then render a human-readable session record — a transparency artifact, not
analytics:

> You began in Non-directive mode and used it for 18 minutes. You later changed to
> Suggestive mode for 9 minutes. During that period the AI offered 6 suggestions;
> you adopted 2 after editing them. All cards in your final map were either
> entered by you or explicitly promoted with provenance shown.

---

# GPT-5.6 Bakeoff (runs after Stage 1.5)

Evaluate the feature-flagged Responses API transport while preserving the typed
response and deterministic-gateway boundary. The implementation uses real
reflection and map-proposal function calls, but neither tool can mutate or
visually stage the map.

Run the same fixed scenarios against Terra low, Terra none, Sol low, and Luna
low. Compare end-to-end latency, structured-response validity, repair rate,
contract/pointer failures, token usage, and function-call argument validity.
The bakeoff is gated on the Stage 1.5 transcript fixture and manual smoke test;
otherwise it measures tolerance for a broken conversation harness instead of
model quality.

## Provider tool-calling checkpoint

The tool implementation begins from local checkpoint `9b32e62` on
`feat/mindmap-provider-tools`. It is an isolated transport experiment, not a new
map-authority path.

- `chat_json` remains the default; `responses_tools` is feature flagged.
- Responses requests use `store: false`, strict schemas, automatic tool choice,
  and disabled parallel calls.
- `propose_reflection_v1` and `propose_map_action_v1` are the only tools and
  normalize into the existing typed response union.
- A rejected call receives at most one matching `function_call_output` repair;
  there is no general tool loop.
- Full calls remain in the local ledger. Outbound study events contain only
  allowlisted transport, tool-name, result-code, and timing metadata.
- Retrieval tools remain deferred until traces demonstrate a context failure.
- Default cutover remains gated on a live browser smoke run, which was
  unavailable at this checkpoint.

---

# Stage 4 — Evals (a workstream, NOT a final phase)

**Timing: starts the moment the second level exists.** The numbering is
misleading — this is not something that happens after Stage 3. The earliest point
a level difference is measurable is when two levels exist, and that is when the
harness must exist. Building all three levels, shipping, and then discovering L0
and L1 are indistinguishable wastes the level design and yields no data
explaining why.

## The gap

Contracts have two halves. The **code half** — the `kind` allowlist and the
`attribution` field — is airtight and belongs in unit tests. The **prompt half**
is the wording inside an allowed kind, and code cannot reach it:

```ts
{ kind: "question",
  text: "Have you considered that transparency might be the umbrella for all of these?" }
```

Passes the L0 allowlist perfectly. It is a question. It is also a structural
proposal wearing a question mark. Every authorship invariant holds — no card, no
map write, clean provenance — and the user's thinking was still directed by the
AI, which is exactly what non-directive claims doesn't happen.

Code protects the artifact. Nothing protects the conversation. Levels are claims
about the conversation.

## Why this is validity, not quality

An eval here is a **manipulation check** — the same thing an HCI experiment runs
to verify the condition did what the method section says. The condition is defined
by a prompt, so the check is a prompt-behavior test.

If L0 and L2 don't reliably differ, any measured difference is noise and any
*absence* of difference is uninterpretable: "the levels don't matter" becomes
indistinguishable from "the levels didn't happen."

## Fails in both directions

- **L0 fails by suggesting** — smuggled AI-originated content into a question.
- **L2 fails by not suggesting** — a suggestive level that never suggests is
  behaviorally identical to L0 and the contrast collapses just as completely.

Score a floor and a ceiling, not just a ceiling.

## Shape

Fixed scenario harness: **same user turns, different contract, real pipeline,
rubric-scored outputs.** Two hard rules — never assert exact strings (the
`loop.test.ts` mistake), and scenarios stay identical across levels since the
level is the only isolated variable.

Scored properties: did the turn introduce a concept absent from the user's prior
turns? assert a relationship the user hadn't stated? offer a direction the user
hadn't raised? was AI-originated material attributed? The code-checkable ones
(attribution, verbatim options) are plain unit tests; the rest need judgment.

## Scoring

1. **Hand-score first.** ~20 scenarios × 3 levels = 60 turns. Tedious once, and
   it's the number you report. Do this before automating — otherwise you don't
   know whether the rubric or the judge is wrong.
2. **LLM-as-judge for regression**, validated against the hand scores, reporting
   agreement. This is the CI artifact.
3. **Code canary, not a gate**: new-content-word ratio against the bank flags
   turns for human review. Cannot be a gate — "what makes that matter to you?"
   legitimately introduces words the user never said. (Possible future audit
   check: the smuggle is usually a *relation* asserted between two known concepts,
   which the 1.0 relation-span machinery could partly detect. Likely
   over-engineering for now.)

## What gets reported

You will never prove L0 never suggests. Characterize the rate:

> Across 20 scenarios, L0 turns introduced AI-originated concepts in 1/20 cases;
> L2 in 17/20.

That's a manipulation check with a number. Claiming enforcement you don't have is
what drew the reviewer's criticism the first time.

Side effect: scenarios that show the level contrast crisply are the demo script.

---

# Think-to-Map

**Stage 1: keep unchanged.** It's config-only (`withQuestionIntentBias`, pacing
thresholds), it doesn't touch authorship, and it's not part of the brittleness.

**Decision point after Stage 2**, with an explicit criterion rather than a vibe:

> Fold Think-to-Map into per-level `pacing` properties **if** its config deltas can
> be expressed as per-level pacing with no loss of expressiveness, **or** if its
> effect cannot be described in one sentence that doesn't overlap with the
> contract level.

The risk it's guarding against: two philosophy-adjacent sliders on the same UI is
worse than one, and harder to explain at a poster. The counter-argument: Think-to-Map
answers "how eager should the AI be to mirror?" while the contract answers "what may
the AI contribute" — genuinely orthogonal axes. The open question is whether users
*perceive* them as orthogonal. Decide with evidence from testing, not now.

---

# Decisions for Nhyira

1. **Two-level or three-level?** Recommendation: build three, run L0 vs L2 as
   study conditions, keep L1 as a demo affordance.
2. **Does `CandidateStore` survive 1.7?** Once readiness is calibration rather
   than a gate, its job shrinks a lot. Needs a look before 1.7.
3. **Composer "Add as card" affordance** to offset the two-act cost of 1.4 — in
   Stage 1 or deferred?
4. **L2 provenance layer** — separate visual layer on the map, or same cards with
   an origin badge? Affects `Map.tsx` scope.

---

# Verification (Windows)

From `prototype-mindmap/`:

```powershell
npx.cmd tsc --noEmit
npm.cmd test -- --run
npm.cmd run build
```

Known: the full suite may report all assertions passing (`568 passed`) but exit
`1` with `[vitest-worker]: Timeout calling "onTaskUpdate"` after the long
`fuzz.loop.test.ts` run. That is a runner/IPC timing artifact, not a failing
assertion — say so explicitly if it happens.

Commit hooks may fail with `/usr/bin/env: 'sh': No such file or directory`. Use
`git -c core.hooksPath=NUL commit ...` **only after** tests/build have run.
