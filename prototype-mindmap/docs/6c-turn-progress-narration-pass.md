# Checkpoint 6c Implementation Spec — Turn-progress narration

Status: **SPEC READY — decided 2026-07-24.** Self-contained implementation
handoff for the one remaining Tier-2 code change. Audience: implementer (Codex)
on `mindmap-main`. The live browser-QA that gates this is written and run in a
**separate** chat — do not run it here.

Authority: this spec restates AGENT-HANDOFF.md item **6c** (lines 505–544) in
buildable detail. If anything here conflicts with product philosophy in
AGENT-HANDOFF.md, stop and ask Nhyira — do not decide unilaterally.

## The problem

Every turn eagerly claims a reflection **before the model has chosen its move**.

- `App.tsx:4073` and `App.tsx:4127` both call `setTurnProgress("initial_attempt")`
  before any model call (the two send paths).
- `TURN_PROGRESS_COPY.initial_attempt` (`App.tsx:96`) reads
  `"Trying to reflect your words..."`.
- So on question / answer / aside / suggestion turns the UI asserts "reflecting"
  that never happens — inaccurate and repetitive.
- `stage1-loop.ts:445` also emits `onProgress({ stage: "initial_attempt" })` on
  call 1 (via `callModel(1, undefined, "initial_attempt")` → line 436).

The escalation stages are already honest and already fire only on genuine
escalation:
- `grounding_repair` → `"Making sure this stays in your words..."` (`callModel(2, …, "grounding_repair")`, line 480)
- `forced_question` → `"Asking a focused question instead..."` (`callModel(3, …, "forced_question")`, line 510)

## Decided behavior (Nhyira 2026-07-24)

1. **First-call phase — no eager narration, no reflection claim.** Show a
   **neutral, ~700 ms-delayed** indicator driven off `loading` via a timer.
   Neutral copy: add a new localized string **`"Working..."`**. (A wordless
   dot/spinner is also acceptable, but the localized-string route is preferred
   for consistency with the existing indicator.) A turn that finishes before
   ~700 ms shows **nothing**.
2. **Escalation stages render immediately, unchanged.** `grounding_repair` and
   `forced_question` keep their existing copy and stay event-driven — they
   already fire only on real escalation.
3. **Retire the `initial_attempt` claim.**
   - **Preferred:** drop the `initial_attempt` emission at `stage1-loop.ts:445`
     (change `callModel(1, undefined, "initial_attempt")` → `callModel(1)` so no
     progress event fires on call 1); the neutral indicator is driven purely by
     `loading` + timer in `App.tsx`. Remove `initial_attempt` from the
     `TurnProgressStage` union (`assistant-response.ts:84`) and retire the
     `"Trying to reflect your words..."` string.
   - **Acceptable alternative:** keep the stage in the union but never render the
     old claim — map `initial_attempt` in the UI to the neutral-delayed
     indicator. (Only take this route if removing the union member causes
     disproportionate test churn; the preferred route is cleaner.)

## Exact change list

### `prototype-mindmap/src/stage1-loop.ts`
- **Line 445:** `callModel(1, undefined, "initial_attempt")` → `callModel(1)`.
  This is the only functional loop change — call 1 must emit no progress event.
  Leave lines 480 (`grounding_repair`) and 510 (`forced_question`) untouched.
- No change to the `callModel` signature or the guard at line 436
  (`if (progressStage) …`) — with no third arg, `progressStage` is `undefined`
  and nothing emits. Good.

### `prototype-mindmap/src/assistant-response.ts`
- **Line 84 (preferred route):** `TurnProgressStage =
  "grounding_repair" | "forced_question"` (drop `"initial_attempt"`).
- `TurnProgressEvent` (line 87) needs no change beyond the narrowed union.

### `prototype-mindmap/src/App.tsx`
- **`TURN_PROGRESS_COPY` (line 95–99):** remove the `initial_attempt` entry.
  With the narrowed `TurnProgressStage` union the `Record<…>` type enforces this
  automatically — you must remove line 96 or it won't compile.
- **Two eager sets — lines 4073 and 4127:** **delete** both
  `setTurnProgress("initial_attempt");` lines. `turnProgress` now only ever
  becomes non-null from a real escalation event via the existing
  `onProgress` handlers (lines 4093 / 4149), which already do
  `setTurnProgress(event.stage)`.
- **New neutral delayed indicator.** Add a boolean state (e.g.
  `const [showWorking, setShowWorking] = useState(false)`) driven by a
  `useEffect` on `loading`:
  - when `loading` turns true, start a ~700 ms `setTimeout` that sets
    `showWorking` true;
  - when `loading` turns false (or on cleanup), clear the timer and set
    `showWorking` false.
  Keep the existing `setTurnProgress(null)` resets at lines 4113 / 4168.
- **Render (lines 4497–4504).** Currently `{loading && turnProgress && (…)}`.
  Change so:
  - if `turnProgress` is set (a real escalation), render
    `t(TURN_PROGRESS_COPY[turnProgress])` exactly as today (immediate);
  - else if `loading && showWorking`, render the neutral indicator
    `t("Working...")` (same `msg assistant` / italic bubble styling);
  - else render nothing.
  Escalation copy must take precedence over the neutral indicator (if an
  escalation fires after 700 ms, show the honest escalation copy, not "Working").

### i18n dictionaries
- **`src/i18n/source.json`:** add the key `"Working..."` (match the existing
  ellipsis convention — the current strings use ASCII `...`, so use
  `"Working..."`, not `"Working…"`).
- **`src/i18n/zh.json`:** add the Chinese value (e.g. `"处理中..."` — confirm with
  the existing translation style in that file). `zh.json` must cover every
  `source.json` key.
- Remove the `"Trying to reflect your words..."` key from `source.json` and
  `zh.json` (and any other locale that carries it) since it is retired. Other
  locales degrade to English by design; only `zh.json` must stay complete.
- Do **not** hand-edit the other ~32 locale files for the new key — they degrade
  to English. (If the `generate-i18n` script from 6a lands first, regenerate;
  it has not landed yet, so English fallback is expected and fine.)

### Tests
- **`stage1-loop.test.ts`:** the two ladder tests referenced in the handoff
  ("uses the capped two-reflection ladder and renders the forced question" @616;
  "ends recovery when the forced-question call returns another response kind"
  @669) assert on emitted progress stages. Update any assertion that expects an
  `initial_attempt` event on call 1 — call 1 now emits **nothing**. The
  `grounding_repair` / `forced_question` emissions are unchanged and must still
  be asserted.
- Add/adjust a test that no progress event is emitted for a plain first-call
  success turn.
- If a test imports the `TurnProgressStage` union or `TURN_PROGRESS_COPY`
  expecting `initial_attempt`, update it.
- The ~700 ms timer is UI-timing behavior; unit-test it only if it's cheap with
  fake timers. Its real coverage is the deferred live QA, not a unit test.

## Verification (run from `prototype-mindmap/`, Windows)

```bash
npx.cmd tsc --noEmit
npm.cmd test -- --run
npm.cmd run build
```

- Vitest may print all-pass yet exit `1` with
  `[vitest-worker]: Timeout calling "onTaskUpdate"` after the fuzz run — a
  runner/IPC artifact, not a failure. Say so explicitly if it happens.
- Commit only after `tsc` + tests + build are green. If the pre-commit hook
  fails with `/usr/bin/env: 'sh'`, use
  `git -c core.hooksPath=NUL commit ...` **only after** the checks pass.

## Out of scope for this pass (do NOT touch)

- The reflection-recovery ladder logic itself (items 2–4) — already built and
  unit-tested; this pass only changes how call 1 is *narrated*.
- The Stage 4 eval / grounded-mirror-rate metric (item 5).
- `App.tsx` decomposition (item 7) and any Checkpoint 6 surfaces (6a/6b/6c-compare).
- The `6b` provenance-grid layout bug — separate item.

## The gate (owed, in a separate chat — NOT here)

The live browser-QA walkthrough is the **real acceptance gate for the whole
reflection-recovery arc**, not just this narration change. It is written and run
in the next chat, numbered-steps + "what to look for / what would be a bug"
format. It must confirm:
- (a) a fast grounding turn shows only the neutral delayed indicator, never a
  false "reflecting" claim;
- (b) a genuinely hard/abstract turn surfaces "Making sure this stays in your
  words..." then "Asking a focused question instead..." **in order**;
- (c) the coach reaches a grounded mirror OR a targeted question, **never a
  dead-end** (the original item-2 motivation, still unverified live).

Do not mark 6c or the arc "done" on unit tests alone — the live pass is the gate.
