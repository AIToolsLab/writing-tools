# Codex Fix Pass 1 — Close the Stage 1.5 Gate

> **Archived implementation checklist (completed).** Stage 1.5, transcript
> ordering, prompt-context truth tests, whole-phrase normalization, dead-gateway
> cleanup, passive anchors, and browser smoke have shipped. The current runtime
> also has a reflection-specific capped three-call ladder, so the universal
> two-call language later in this historical checklist is superseded by
> `DESIGN.md` and `refactor-plan.md`. Do not execute this file as a current plan.

**Goal:** finish Stage 1.5 conversation-context stabilization and reach the
manual browser smoke test, which is the gate blocking the GPT-5.6 bakeoff and the
`responses_tools` default cutover.

**Source of truth:** `refactor-plan.md` §1.5 (the *why* and the full spec). This
doc is the *do-this-now* checklist. If the two ever disagree, `refactor-plan.md`
and `DESIGN.md` win.

**Branch:** `feat/mindmap-provenance-completion`. The working tree already has
uncommitted changes from the prior pass (doc rewrites + the
`tentativeEvidencePattern` removal). **Commit those first** (after `tsc` + tests),
then build on top — do not redo them.

---

## Already done — do NOT repeat

- §1.5.1 call-time dialogue history: `historyForCurrentTurn` is wired into the
  live `send` path in `App.tsx`; the redundant foregrounded "LATEST USER TURN"
  prompt section is already gone from `renderContext`.
- The `tentativeEvidencePattern` semantic classifier is removed from
  `validator.ts` / `config.ts` / `types.ts` (`MirrorCheckName`).
- No `detectedSignals` / keyword-interpretation fields are rendered to the model.

## In scope for this pass (no product decisions required)

### Task A — Transcript ordering fixture
`refactor-plan.md` §1.5.3, first bullet. Extend `src/api.test.ts` (or add
`src/history.test.ts`).

- Build a committed transcript that ends on an **assistant question**, then a new
  user turn. Call `historyForCurrentTurn(committed, userText)` and assert:
  - the newest user turn is included **exactly once** and is **last**;
  - role ordering is preserved and the history is capped at the existing window;
  - **guard:** the rendered system prompt (`systemPrompt` → `renderContext`) does
    **not** reintroduce a separate foregrounded latest-user-turn section.
- Repair-local history: assert that ordinary recovery sees the rejected assistant
  response (closure history) **plus** the structured rejection and remains capped
  at two calls. Reflection grounding has the documented three-call exception.

### Task B — Prompt-context truth tests
`refactor-plan.md` §1.5.2 / §1.5.3. Extend `src/api.test.ts`. Assert
`buildContext` → `renderContext` surface these as **facts**, and that a capable
reader could not mistake them for code interpreting user wording:

- selected focus (cards + draft selection),
- explicit support request (`requestedSupport`),
- sparse-map advisory (`mapPacing.isSparse`),
- capability manifest (`canDo` / `cantDo`) reflects real config,
- measured turn size (`turnShape`),
- raw draft text.

Negative assertion: no keyword/regex "detected signal" field appears in the
rendered prompt.

### Task C — Whole-phrase normalization regression
`refactor-plan.md` §1.5.3, third bullet. In `src/normalize.test.ts`, assert
`containsWholePhrase("underrated", "under") === false` (and a couple of sibling
mid-word cases), so a substring can never satisfy a verbatim pointer check.

### Task D — Delete dead gateway branches (pure cleanup, no behavior change)
`action-gateway.ts` `resolveRef`: `if (near.length > 0)` shadows the following
`near.length > 1` and `near.length === 1` returns, which are unreachable. For
this pass, **delete the two dead lines only** — do not change resolution
behavior. (The confirm-vs-choose UX refinement the dead code hinted at is a
separate, deferred UX decision.)

### Task E — Verification and the smoke-test gate
Run, from `prototype-mindmap/`:

```powershell
npx.cmd tsc --noEmit
npm.cmd test -- --run
npm.cmd run build
```

Then the **manual browser smoke test** (this is the real gate):
- Start the dev server and drive the reported unanswered-question / anaphora
  transcript in the live app. If the original report isn't recoverable,
  construct a representative case: the coach asks a narrowing question → the user
  answers with a short/pronoun reply → confirm the coach **builds on that reply**
  and does **not** re-ask its own prior question as if unanswered.
- Verify behavior yourself in the browser; a green unit suite is necessary but
  not sufficient for this gate.

## Definition of done

- Tasks A–D implemented; `tsc` clean; full suite green (note the known
  `fuzz` vitest-worker IPC timeout if it appears — that is not a failing
  assertion); build succeeds.
- The browser smoke test passes and is described in the commit / handoff note.
- `CODEX-HANDOFF-next-chat-untracked.md` outstanding-list item 1 is checked off,
  and the doc notes that the bakeoff is now unblocked.

## Non-goals for this pass (do not touch)

- **Open-threads delete-vs-rebuild** — needs a Nhyira decision (it changes a
  user-facing capability claim). Leave `open-threads.ts`, `state.openThreads`,
  the Control Room section, the "OPEN THREAD CALIBRATION" prompt block, and the
  parked-phrase capability line exactly as they are.
- **`App.tsx` decomposition** and the **`src/` folder reorganization** — both
  deferred and both pending timing/decision.
- **Stage 2 UI**, the **GPT-5.6 bakeoff**, **provider-tool default cutover**, and
  **LiveKit** — all downstream of this gate.
- No additional ordinary repair call, no canned coach fallback, no forced map
  proposal, no regex routing, no chat yes/no proposal resolution, no direct
  model map mutation. Reflection grounding alone may use the capped informed
  repair plus forced-question call described in the canonical docs.

## Windows notes

- Use `npx.cmd` / `npm.cmd`.
- If committing fails with `/usr/bin/env: 'sh': No such file or directory`, use
  `git -c core.hooksPath=NUL commit ...` — **only after** tests/build have run.
