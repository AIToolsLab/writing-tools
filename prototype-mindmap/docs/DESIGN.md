# Reflective Mind-Map — Design

The canonical design document. It has three layers, written at different
durabilities:

1. **Aim & philosophy** — why the tool exists and the invariants everything
   hangs off. Stable; change rarely.
2. **What the app must do** — the behaviors required to honor the philosophy,
   described without code. This doubles as the eval rubric.
3. **How it's implemented** — thin pointers to where each behavior lives in the
   code. Expected to drift; kept to file/function references, not copied code.

Then a **decisions & rejected alternatives** log — the *why-nots*, which is where
the philosophy actually bites.

The existing briefs (`map-build-brief.md`, `airtightness-report.md`,
`mirror-fixes-brief.md`) are appendices this document links, not content it
repeats.

---

## 1. Aim & philosophy

### What it is

A **writing-thinking tool, not a writing-production tool.** The user externalizes
their *own* thinking into a concept map. The AI helps them think — it questions,
reflects their own words back, notices when clarification is needed, and captures
*confirmed* structure onto a canvas. It never authors ideas, names relationships,
or decides what belongs where.

The central bet: **constrained dialogue plus a user-grounded external map helps a
person construct and recognize their own thinking more deeply than either
freeform chat or AI-generated prose** — and the grounding constraints create
productive friction rather than parroting or busywork.

### The invariant spine

Every behavior and every implementation choice hangs off these. To check whether
a feature belongs, check it against the spine.

1. **The user authors every idea, label, hierarchy, role, and connection.**
2. **The AI never authors *ungrounded* structure.** It questions and reflects the
   user's own words; it does not invent ideas or relationships.
3. **Validation gates the AI, never the user.** The map is the user's sovereign
   workspace — no gate ever blocks a user action on it.
4. **Selection is authorship.** The AI never decides *which* ideas become cards.
   The user selects (explicitly, or by confirming a grounded reflection).
5. **The slider moves eagerness, never the authorship gate.** Pacing changes with
   the Think↔Map slider; grounding and confirmation never do.
6. **Enforcement in code, calibration in config.** The non-negotiable
   constraints are enforced deterministically; the tunable numbers live in one
   config surface.

A useful corollary that resolves most edge cases: **the AI may *interpret*
freely, but the *consequential* act (what becomes structure) is always fenced by
grounding + user confirmation, or is a direct user action.** Interpretation is
where the model is strong; authorship is where the code stays strict.

---

## 2. What the app must do (behavior, no code)

Each item states the behavior and which invariant it serves.

### 2.1 Capture the user's words faithfully
A big voice/text turn is split into sentence-level units, each recorded verbatim
as the ground truth. Nothing the AI says is ever treated as the user's words.
*(Serves 1, 2 — grounding has something real to check against.)*

### 2.2 Ask questions that make the user think
The coach makes one move per turn: at most a short grounding clause followed by a
single question, and the turn ends on that question. It reads the user's state
and chooses how hard to push (**settle / narrow / deepen / organize /
challenge**). It never re-asks a settled point, never validates-as-the-whole-
reply, and advances at the smallest useful step. When the user is confused, it
re-angles rather than repeating. *(Serves the thinking-first aim.)*

### 2.3 Reflect structure back — only when grounded and ready
A **mirror** restates the *structure* the coach heard (what is bigger, what sits
under what, what connects what) **in the user's own words**. It is offered only
when an idea is *ready* (the user has grounded it) and only after it passes
validation (the words trace to the user; relationships come from a single user
utterance). A failed mirror becomes a clarifying question, never leaked prose.
*(Serves 2 — the AI reflects, never authors.)*

### 2.4 Let the user confirm or revise before anything becomes structure
A mirror is a set of **confirmable chunks**. Only a chunk the user confirms
becomes a card. The user can decline or revise. *(Serves 1, 4.)*

### 2.5 Recognize explicit commitment and fast-track it
When the user explicitly commits an idea ("the main idea I want to carry forward
is X"), a single clear, grounded statement can be mirrored immediately rather than
forced through repeated questioning — still validated, still confirmed. This is
the purest authorship signal, so it is honored at **any** slider position.
*(Serves 1, 4, 5.)*

### 2.6 Treat direct map commands as user actions
"Put X on the map," "make a card for X" is a **direct user action**, not an AI
reflection. It places a card from the user's verbatim words, with no mirror, no
validation gate, and no confirmation. Declaratives ("X is a main idea") are *not*
commands — they go to the mirror path. Vague references ("put my main point on
the map") prompt for the exact wording. *(Serves 3 — the map is sovereign;
commands are user actions.)*

### 2.7 Never harvest or select for the user
For a long/exploratory turn, the coach does **not** extract N cards. It mirrors
only what the user explicitly declared or clearly grounded by returning to it;
otherwise it asks one focusing question that hands selection back to the user. The
longer and richer the input, the *more* careful the coach is about selecting
structure. *(Serves 4 — selection is authorship.)*

### 2.8 A sovereign, manipulable map
Confirmed reflections appear as cards. The user freely drags, titles, groups
(nesting renders a card *inside* its parent), pulls out, connects (user-labeled
or unlabeled — the AI never invents a label), deletes, and undoes. No map action
is ever blocked by validation. *(Serves 1, 3.)*

### 2.9 A draft the AI can see but never edit
The user's draft is a read-only reference the AI can anchor questions to
(highlighting the region) but never rewrites. *(Serves 1, 2.)*

### 2.10 A slider that controls eagerness, not authorship
Think↔Map continuously changes how eagerly the coach moves toward mirroring
*non-declared* ideas (pacing). It never changes grounding, confirmation, or
whether an explicit declaration fast-tracks. At full Map the coach builds
structure quickly *once the user chooses* — it never starts choosing. *(Serves 5.)*

### 2.11 Stay grounded as the user edits the map
Every user action that introduces wording on the map (a new card, a connection
phrase, an edit) is written back into the shared word store, so the AI stays aware
of everything the user authored on the canvas. *(Serves 2 — the AI's later
reflections remain grounded in the larger set of user words.)*

### 2.12 Be diagnosable
Every coach decision is inspectable: the mode, the suppression reason (cooldown /
missing-payload / not-ready / batch / validation-failed) with the failing check
and its score/threshold, the full validation payload (claim text, span phrase,
cited utterance ids *and* text), and the success-side carry-forward notes
(which candidate was accelerated, and why). *(Operational, not philosophical —
but it is what keeps the other behaviors verifiable, and it is what turns
"felt wrong" eval reports into "span_grounding 0.62/0.75".)*

---

## 3. How it's implemented (thin pointers)

| Behavior | Where | Key mechanism |
| --- | --- | --- |
| 2.1 Capture | `store.ts` (`SourceBank.addSegmented`), `normalize.ts` (`segment`) | Split on `.!?`/newlines into per-unit utterances sharing a turn id |
| 2.2 Questioning | `api.ts` (`systemPrompt` QUESTION MODE + stance rules), `llm-contract.ts` (`questionStance`), `controller.ts` (anti-repeat guard, stuck override) | Stance emitted + surfaced; verbatim-repeat de-escalates in code |
| 2.3 Mirror + readiness + validation | `readiness.ts` (`evaluateReadiness`), `validator.ts` (lexical + span grounding), `controller.ts` (mirror branch) | Readiness gates *attempt*; validator gates *grounding*; fail → clarify |
| 2.4 Confirmation | `controller.ts` (`validatedMirror`), `App.tsx` (`decideClaim`) | Per-chunk confirm; card created only on confirm |
| 2.5 Carry-forward | `llm-contract.ts` (`carryForwardCandidateIds`), `controller.ts` (idea-only, this-turn, substantive, source-spanned filter), `readiness.ts` (`acceleratedIdeaIds`) | Accelerates *density only*, idea-only, validation + confirmation intact |
| 2.6 Map commands | `llm-contract.ts` (`mapCommands`), `controller.ts` (`acceptedMapCommands`, blockers), `map-commands.ts` (`applyAcceptedMapCommands`) | Hard guards: verbatim this-turn span + cited-id match (fail-closed). Soft guard: declarative/tentative/referential blocklist trusting the LLM |
| 2.7 No-harvest | `api.ts` (large-turn / block-type prompt rules) | Mirror declared/grounded only; otherwise one focusing question |
| 2.8 Sovereign map | `map-store.ts` (`ThoughtUnitStore`), `Map.tsx` (embedded nesting, edges, edge badge, delete, undo) | One primitive (the card); nesting = re-parent rendered as DOM embedding |
| 2.9 Draft anchoring | `App.tsx` (draft panel + backdrop highlight), `api.ts` (`questionAnchor`) | Read-only draft; verbatim anchor highlighted |
| 2.10 Slider | `config.ts` (`withQuestionIntentBias`, `mapPressure`) | Continuous shift of pacing thresholds only |
| 2.11 Map writeback | `map-store.ts` (`editText`, `registerConnection`, `addFromUserUtterance`), `App.tsx` (passes `stateRef.current.bank`) | Map writes `node_edit`/`declaration` utterances into the **shared** bank |
| 2.12 Diagnostics | `controller.ts` (`suppressionReason`, `validationDebug`), `Map.tsx` Debug panel | Reason + failing check/score surfaced |

**The one integration that must never break:** the map and the chat loop share a
**single `SourceBank` instance** (`stateRef.current.bank`). If a second bank ever
exists, map edits silently never reach the AI and grounding drifts with no error.
All map writes and undo restores go through that one instance.

---

## 4. Decisions & rejected alternatives

The *why-nots*. Re-introducing any of these would violate the spine.

- **Deterministic phrase lists vs LLM interpretation.** *Coaching register*
  (stance), *commitment* recognition, and *map-command* speech acts are
  **LLM-interpreted** — phrase lists are brittle and miss phrasings. But the
  *consequential* gates — mirror validation, hierarchy spontaneity, command
  verbatim/this-turn checks — stay **code-only**, because there the model's
  judgment could fabricate authorship. Split rule: model interprets, code fences
  the act.

- **No `softMaxMirrorChunks` trim in the controller.** *Rejected.* A code-level
  cap would silently drop *user-grounded* claims — moving AI-selection into the
  enforcement layer, the opposite of invariant 4. If many ideas are ready, that's
  a signal the turn was a dump → ask a focusing question (2.7), never trim.

- **Declaration recognition is not slider-gated.** An earlier version gated
  "carry-forward pressure" on `mapPressure ≥ 0.75`. *Removed* — explicit intent
  must be honored at any position (invariant 5). The slider's only job is
  continuous pacing for *non-declared* ideas.

- **Carry-forward is fenced to `idea` targets.** It accelerates *density only*.
  It must never satisfy relationship clarity, hierarchy spontaneity, or
  connection grounding — those are real structure the user must author. An idea
  is just the user's own validated concept.

- **Map commands: blocklist + hard verbatim guard, not a whitelist.** An earlier
  whitelist of placement phrasings failed *closed* on valid-but-unusual commands.
  Inverted: trust the LLM's `create_card`, but keep the **verbatim this-turn span
  + cited-id** guards fail-closed (a card is always the user's literal current
  words) and block obvious declaratives/tentatives/referentials. A residual
  false-positive is low-harm: a deletable, undoable card of the user's own words.

- **Nesting renders as DOM embedding, not xyflow subflows.** *Chosen* so a nested
  card sits visually *inside* its parent (matching the user's mental model) with
  one primitive (the card) rather than a separate container object.

- **Connection labels are optional; the AI never invents one.** A user-drawn edge
  with no wording is a valid user-authored relationship; the AI naming it would be
  authoring structure.

- **Validation never blocks a user map action.** The map is sovereign (invariant
  3). Direct commands bypass mirror/validation entirely; map edits write back to
  the bank rather than being checked.

- **Model: `gpt-5.4-mini` is sufficient.** Every observed failure has been
  *coordination* (wrong utterance id, claim drift, missing flag) — a
  prompt/controller concern — not *judgment*. **Upgrade trip-wire:** revisit the
  model only if failures become judgment-shaped (mirrors a compound idea badly,
  or fails to mirror after the user clearly answers, or over-narrows).

- **Eval rubric: "mirror within ~1 productive turn," not "immediately."** One
  focusing question on a compound/contrastive idea before mirroring is a *pass*,
  not a miss — forcing immediate mirroring everywhere would make the tool an
  extractor, against the thinking-first aim.

---

## Status (as of this writing)

Built and tested: capture/segmentation, question mode + stance, readiness +
validation, per-chunk confirmation, carry-forward, the sovereign map (cards,
embedded nesting, connections, delete, undo), draft anchoring, the slider,
diagnostics, and **Phase 1 of direct map commands (`create_card`)**.

Not yet built: direct **structure** commands (`nest_card`, `connect_cards`) —
they need confident reference resolution, ambiguity handling, and undo coverage
for relationship changes, carried with the same "ask-when-unsure + undo-as-net +
tested-negatives" discipline.
