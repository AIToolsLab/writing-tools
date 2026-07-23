# Codex Pass 2 — Stage 4 Eval Harness (first slice)

> **Archived first-slice checklist (completed and extended).** The real-pipeline
> runner, deterministic 20-scenario L0/L2 reportable suite, 40-row CSV workflow,
> aggregation, provider bakeoff traces, controlled recall, recovery UI, and
> contract tests now exist. Current scoring also covers hidden question premises
> and confusing quotation. Use `eval/README.md` for commands and the handoff for
> the outstanding live run; do not treat the “Remaining: Task 1” note below as
> current.

**Goal:** stand up the manipulation-check harness that measures whether the
assistance levels actually differ in behavior. This is the research-validity
path — the thing a reviewer asks for — and the plan says it starts the moment a
second level exists (it does). Its crisp scenarios also become the demo script.

**Source of truth:** `refactor-plan.md` "Stage 4 — Evals". This doc scopes a
*first slice*: get a real-pipeline scenario runner + hand-scoring workflow in
place. Do **not** try to build the whole thing (LLM-as-judge automation is a
later pass — hand-score first).

**Branch:** `feat/mindmap-provenance-completion`. Prerequisite Stage 1.5 gate is
closed; open-threads was deleted. The contracts (`assistance-contract.ts`, L0/L1/
L2) are code-complete and enforced — this pass measures them, it does not change
enforcement.

> **Status (2026-07-20, late):** Task 0 and Task 2 already shipped.
> - **Task 0a/0b — DONE** (`d7f1ac1`): the Control Room now surfaces held/ignored
>   ideas from candidates using the user's evidence wording; a failed repair now
>   produces an honest recovery instead of silence.
> - **Task 2 — DONE** (`0d42c5e`): working-memory recall — candidate `status`
>   plus an `ageInTurns` staleness fact; the model owns recall, code never matches
>   user text. Seeded `eval/scenarios/recall.ts`.
> - **Task 1 — DONE and extended:** the runner, stable hand-score CSV, report
>   validation/aggregation, 20 paired scenarios, and capability/bakeoff fields are
>   implemented. Live execution and human scoring remain evidence work rather
>   than missing harness code.

---

## The gap being measured

The **code half** of a contract (the `kind` allowlist + the `attribution`/origin
field) is airtight and belongs in unit tests. The **prompt half** — the wording
*inside* an allowed kind — is unreachable by code:

```
{ kind: "question",
  text: "Have you considered that transparency is the umbrella for all of these?" }
```

Passes the L0 allowlist perfectly and still directs the user's thinking. Levels
are claims about the conversation; only an eval characterizes them. Score a
**floor and a ceiling**: L0 fails by smuggling a suggestion; L2 fails by never
suggesting. Both directions matter.

## Task 0 — Pre-harness fixes (transparency + memory surface)

Do these first. Both are small, both are pure wins, and both make the harness
transcripts more legible. They also begin the cognitive-offloading work (see
Task 2) with zero recall logic.

### 0a. Surface the ideas the model is holding (fix the dead panel)
`buildDiagnosticSnapshot` (`understanding.ts`) ignores its `_candidates` argument
and always returns `trackedIdeas: []`, so the Control Room "Ideas I'm tracking"
panel is permanently empty even though `App.tsx` passes candidates into it. Project
the `CandidateThought[]` into `trackedIdeas`:
- Label each held idea with the user's **own evidence wording** (resolve
  `evidenceUtteranceIds` → SourceBank text). Do **not** show the raw `gist` — it
  is AI-authored internal prose ("never shown as-is to the user", `types.ts:50`);
  displaying it would put AI wording in a panel the user reads as "my ideas."
- Do **not** reintroduce readiness meters/status — `readiness.ts` was deleted in
  Stage 1.5. Simplify the `TrackedIdea` shape (drop `meters`/`status` or set them
  neutral); the panel shows what is held, not a readiness score.
- Result: the user sees "X" and "X↔Y" being remembered — the first, zero-recall
  step of cognitive offloading, and it makes candidate tracking honest and visible.

### 0b. Honest repair-failure recovery
Historically, when the single ordinary repair also failed, `processTurn` returned `{ diagnostics }` with no
response and `App.tsx` (~line 3714) updates Control Room diagnostics and returns —
nothing appears in chat, so the user sent a message and the coach silently did
nothing.
- Add a minimal, honest in-chat terminal state: a plain-language line (no
  validation jargon) such as "I couldn't tie that to your exact words — want to
  rephrase or try again?" plus a retry affordance. This is terminal UI state, **not**
  a fabricated coach turn — do not invent a coach response.
- Keep the machine-readable detail in the Control Room, where it already lands.
- Rationale: a silent failure quietly teaches the user the tool is unreliable,
  undermining the trust the whole product depends on.

## Task 1 — Stand up the eval harness (steps A–D)

### Task A — Contract-matrix unit tests (the code half)
Extend `assistance-contract.test.ts` / `stage1-loop.test.ts` so the enforceable
boundaries are locked as plain unit tests with deterministic mock models:
- L0 rejects a `suggestion` kind and rejects an `inferred`/`ai_suggested`
  reflection or map action.
- L1 accepts `options` **only** when every option is a verbatim user span;
  rejects a non-verbatim option.
- L2 accepts `ai_suggested` structure but the resulting card/edge carries
  `origin: "ai_suggested"` (attribution preserved, never `user_asserted`).
These are assertions about `kind`/origin, never about model wording.

### Task B — Scenario schema + seed set
Add `eval/scenarios/` with a small, typed scenario format:
```ts
interface EvalScenario {
  id: string;
  title: string;
  userTurns: string[];              // identical across levels — the isolated variable is the level
  smuggleNote: string;              // what an L0 violation would look like here (for the human scorer)
}
```
Seed **5–8** scenarios now (expandable toward the ~20 the plan wants). Each must
be a realistic thinking-aloud sequence where a directive move is *tempting* —
e.g. the user lists three ideas that share an obvious umbrella the user never
named.

### Task C — Real-pipeline runner
Add `eval/run.ts`, invoked via a new `npm run eval` script. For each
(scenario × level in {0, 2}) — L1 optional — it:
- builds a fresh `ConversationState` and `ThoughtUnitStore`;
- replays `userTurns` through the **real** `processTurn` with
  `contract = contractForLevel(level)` and a live `makeLLM` (default GPT-5.6
  Terra low, `chat_json`);
- records, per assistant turn: response `kind`, computed `origin`,
  `influenceTrace.overlapRatio`, and a code canary `newContentWordRatio`
  (content words in the assistant turn absent from the SourceBank so far, using
  `normalize.contentTokens`);
- writes a per-run transcript + a metrics table to `eval/runs/<timestamp>/`
  (git-ignored) as JSONL + a readable Markdown summary.

Hard rules (from the plan): **never assert exact strings**, and scenarios are
**identical across levels** — the level is the only variable.

### Task D — Hand-scoring template
From a run, emit `eval/runs/<timestamp>/handscore.md` (or CSV): one row per
(scenario, level, turn) with the metrics pre-filled and blank columns for the
human judgment properties:
- introduced a concept absent from the user's prior turns? (Y/N)
- asserted a relationship the user hadn't stated? (Y/N)
- offered a direction the user hadn't raised? (Y/N)
- was AI-originated material attributed? (Y/N/NA)

Hand-scoring ~20 scenarios × {L0, L2} is the number you report; do it before any
automation.

## Task 2 (after the harness) — cognitive-offloading recall scaffold

Builds directly on Task 0a. Goal: the "it never forgets; I can speak freely and it
holds my threads" feeling — **model-owned, code-supported**, never code-interpreted.
The substrate already exists (`CandidateStore`: the model nominates candidates via
`advisory.candidateUpserts`, code persists and replays them). What is missing is a
recall scaffold and the anti-nagging guard.

- **Code supplies a fact, not a decision:** for each held candidate, how many turns
  since it was last touched (age), surfaced in context like the sparse-map pacing
  fact. Code does **not** decide the user "returned" to a topic and does **not**
  match user text to held items. (Text-matching recall was the unsound half of the
  deleted `open-threads` — do not bring it back.)
- **The model owns the recall move:** it may say "want to come back to X?" using
  the user's own wording. Code never triggers recall.
- **Anti-nagging guard:** reuse a lightweight status on candidates
  (parked/active/ignored/promoted) so a dismissed recall is not re-offered. (This
  status model was the *sound* part of `open-threads`.)
- **Placement still crosses the gateway:** a recalled idea that becomes a card is
  still verbatim-grounded and explicitly confirmed. Recall changes what is
  *surfaced*, never what is *placed*, and is logged as influence (`InfluenceTrace`).

This is a feature slice, not part of the harness — sequence it after Task 1 unless
demo usefulness is the priority, in which case Task 0 + Task 2 can lead.

## Definition of done

- Task 0: the "Ideas I'm tracking" panel shows held candidates in the user's own
  wording; a failed repair produces an honest in-chat message + retry rather than
  silence. Verified in the browser.
- Task A unit tests pass; `tsc` clean; full suite green (note any fuzz
  vitest-worker IPC timeout as a runner artifact, not a failure).
- `npm run eval` runs a seed scenario through the real pipeline against a running
  backend and produces the transcript, metrics, and hand-score template.
- A short `eval/README.md` explains how to run it, that the canary is **not** a
  gate, and that hand-scoring precedes LLM-as-judge.

## Non-goals for this slice

- **No LLM-as-judge automation yet** — hand-score first, then validate a judge
  against those scores in a later pass.
- The `newContentWordRatio` canary is **advisory only, never a gate** — "what
  makes that matter to you?" legitimately introduces new words.
- No change to any authorship enforcement (validator, gateway, contracts,
  provenance). The harness observes; it does not alter the pipeline.
- No Stage 2 UI work and no GPT-5.6 bakeoff here — the bakeoff reuses these
  scenarios but is separate downstream work.

## Prerequisites / notes

- The runner hits the real backend (`VITE_BACKEND_URL`, default
  `http://localhost:8000/api`); start it first. Consider a recorded-fixture mode
  later so runs are replayable offline, but live is fine for the first slice.
- Keep `eval/runs/` out of git (add to `.gitignore`); commit scenarios and the
  runner, not run outputs.
- Windows: `npm.cmd` / `npx.cmd`; hook-bypass commit only after tests/build.
