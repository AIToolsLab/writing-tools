# Fable hardening pass — running notes (2026-07-04)

Baseline at HEAD `20c20b6`: tsc clean, 358/358 vitest green, tree clean (3 untracked docs untouched).
Current: tsc clean, 472/472 green (100 fuzz runs + 14 new regression tests added).

## Summary (one line per finding)

- [x] F1 harness BUILT: `src/fuzz.loop.test.ts` — 100 seeded runs × 60+ turns, 6 invariants/turn; found F2, F3, F6
- [x] F2 FIXED (severe): validator let the AI stitch two grounded user sentences with an invented connective ("A. leads to B.") into a shipped connection mirror — claim-level one-breath binding added (validator.ts)
- [x] F3 FIXED: model-authored clarify phrases (turn.clarifySpan / failing weakestSpan / validationDebug span) were quoted back as the USER's words in chat + Under-the-Hood — attribution sanitizer added (controller.ts, understanding.ts)
- [x] F4 FIXED: clarifyTarget wedge — never cleared on question-mode turns, permanently suppressing mirror-pressure/salience bridges + stale UTH "waiting for" (controller.ts default branch)
- [x] F5 FIXED: captureLoop repeat-memory survived its elicitation (override block + finish() else), could trip the capture_loop clarify on the FIRST repeat of a later unrelated elicitation
- [x] F6 FIXED: settle-backstop drift (brief item 5) — settle re-ask referencing a stale "not sure" with low concept-overlap now steered via referencesStaleUncertainty
- [x] F7 FIXED (visual verify pending): nested-card edges — invisible `anchorProxy` React Flow nodes
  (parented to the root ancestor, DOM-measured to the embedded card's spot) keep edges attached to the
  REAL child card id; `proxyAnchorSpecs` is pure + tested (Map.test.ts, 6 tests)
- [x] F8 SWEEP DONE: verdicts — clarifyTarget WEDGE (fixed, F4); captureLoop STALE (fixed, F5);
  organizeFocus AIRTIGHT (declineCount survives exactly when the coach re-asks the same pair — correct);
  coverageFocus AIRTIGHT (cleared on substantive/commands/pivot); activeElicitation/pendingCardWording
  AIRTIGHT (fuzz escape probes green); pendingChildPlacement had a stale-parent hole (fixed, F11);
  activeSelectionContext = stale-influence judgment call (recorded below); App.tsx persistence is
  symmetric (clone/save/restore cover the same fields)
- [x] F9 FIXED (enforcement): (a) LLM-emitted nest_card between two EXISTING cards had NO current-turn
  gate — model could quietly author hierarchy; now both cards must be named this turn + instruction-shaped
  nest wording. (b) connect_cards between existing cards executed on any connect-word — "these two ideas
  connect deeply" (declarative) could author an edge; now requires instruction-shaped wording or a #ref
  pair. (c) exact-phrase checks were raw substrings — "art" inside "start" counted as current-turn
  wording; now word-boundary. All with regression tests.
- [x] F11 FIXED: pending confirmations executed against cards deleted mid-flow — map layer silently
  no-ops (ensureCard returns undefined) while chat says "Done." Now any pending whose referenced ids are
  gone is dropped with an honest notice (`pending_command_stale_reference`); same for child placement.
- [x] F10 dead code: removed unreachable second `find` in map-commands.ts ensureCard (predicate strictly
  subsumed by the first); removed vestigial `awaitingCorrection` on relationship_confirmation (never set
  true — and a legacy-persisted `true` would have turned a "yes" into the literal label via the
  catch-all); fixed stale controller header comment ("LLM never sees ThoughtUnits" — it does, read-only).
- [x] docs/airtightness-report.md updated to match the tightened gates (verification line, relationship
  binding row, new attribution + stale-pending rows, nest/connect/create row updates)

## Fix details (file anchors as of this pass)

### F2 — cross-utterance relationship stitching (validator.ts)
Attack: claims [span A (verbatim utt1), span B (verbatim utt2)], claim.text = "utt1 leads to utt2",
target connection. Each span passes; each sentence happens to contain some RELATION_TERM, so the
old per-span binding passed. Shipped as a real mirror (fuzz seeds 111/122/127).
Fix: `claimRelationStatedInOneUtterance` — some single cited utterance must carry EVERY relational
term the claim text uses AND ground >= spanGroundingMin of the claim's content tokens.
Second iteration: term binding added because a pure ratio leaked short-tail stitches ("...leads to nope").
Tests: validator.test.ts "stitched together with an invented connective", "short-tail stitch", plus
a legit multi-utterance-citation pass case.

### F3 — user-attribution leak (controller.ts + understanding.ts)
Three surfaces: (1) `when you said "<weakestSpan.userPhrase>"` in the mirror-fail clarify text — the
weakest span FAILED grounding, so its phrase can be model-invented; (2) `state.clarifyTarget` from
unvalidated `turn.clarifySpan` -> UTH waitingFor quotes it as "your own wording on ..."; (3)
understanding.ts `validationEvidence` surfaced the failing span's phrase as user evidence.
Fix: `isUserAttributablePhrase`/`sanitizeClarifySpan` (normalized-substring-of-bank check) at both
controller pin sites + grounded-in-cited-utterances check in validationEvidence.
Tests: loop.test.ts "hardening: model-authored clarify phrases..." (4 cases), understanding.test.ts
"never surfaces a failing span's phrase...".

### F4 — clarifyTarget lifecycle (controller.ts)
Set on validation failure + clarify turns; was only cleared on stuck/mirror/DE_ESCALATE/goal-5/focus-help.
A single failed mirror left the pin for the rest of the session unless one of those fired: bridges
(mirror_pressure/draft_salience) gated by repairClarifyActive were suppressed forever, UTH kept a stale
"waiting for", prompts kept the stale anchor. Fix: question-mode default branch clears it (the model has
moved off the clarify thread); consecutive clarify turns still keep it.
Tests: loop.test.ts "hardening: clarify pin lifecycle" (clear on question, keep across clarifies).

### F5 — captureLoop stale repeat-memory (controller.ts)
Cleared on mirror + next ingest turn, but NOT in finish()'s elicitation-ending else branch nor the
overrideMode reset — a stale lastAnswerNorm could increment across a later unrelated elicitation and
fire the capture_loop clarify one repeat early. Now the capture flow (elicitation + pendingCardWording +
captureLoop) dies together. Tests: "hardening: capture-loop memory dies with its elicitation".

### F6 — settle drift (controller.ts finish, Goal-5 block)
`referencesStaleUncertainty` (you said/earlier/before ... not sure/unsure/stuck/no idea) OR'd with the
0.6 concept-overlap gate, same steer (map-aware transition vs DE_ESCALATE). Tests: "hardening:
stale-uncertainty settle drift" (steer + leave-fresh-settle-alone).

## Harness (F1)
`src/fuzz.loop.test.ts`. 3 suites: default config (seeds 1-40), readiness/pacing opened (101-140),
map-lean slider (201-220); 60 turns/run + escape probes. Adversarial mock LLM: invented mirrors,
cross-utterance stitches, model-prose gists ("modelprose"), invented clarify spans, fabricated/stale
map commands ("zyxxq" marker), fake evidence ids, carry-forward gaming. Drives a REAL ThoughtUnitStore
(applyAcceptedMapCommands, shared bank), random sovereign deletes/edits mid-run.
Invariants: I1 never throws; I2 valid mode/non-empty text; I3 mirror revalidates + preamble + user
vocabulary; I4 commands mint only user-substring text, map only ever contains user vocabulary; I5 UTH
snapshot carries no command shapes and no marker prose; I6 wedge probe — any transient field set 10
consecutive turns must clear under cancel/cancel/move-on/substantive escape.
Run: `npm test -- --run fuzz.loop` (from prototype-mindmap/).

## UI pass — layout/routing cluster (2026-07-04, second session)

User directed a UI handoff (7 items); items 3/6/7 landed elsewhere during a quota gap. Per the
answered scoping questions I took **layout/routing first (#1,#2,#4,#5)**, **own map-layout.ts**, and
**verified visually in the preview**. tsc + vite build clean, 499 vitest green (map-layout 7→14 tests).

- **#1 Auto-clean respects existing layout — `map-layout.ts` rewrite.** Root cause: Dagre ranks the
  hierarchy AND reorders siblings by its own crossing-minimization, scrambling the user's left/right
  arrangement. Fix: keep Dagre only for vertical ranks, then `reorderRanksByUserX` clusters nodes by
  Dagre y and re-lays each rank left-to-right in the user's existing x-order (stable by x, then y, then
  id), spaced by width — no overlap, idempotent. Added `inferVerticalEdges`: neutral connections with a
  clear user vertical gap get a soft top→bottom rank edge so a hand-built vertical tree isn't flattened.
  **Preview-verified**: source #500 at y=80 centered over three children at y=288 in preserved order
  audit(80) < user(354) < shared(628); re-run idempotent (unit test).
- **#2 Connector routing — `computeConnectionHandles` (new export) + autoClean wiring + `store.setConnectionHandles`.**
  After layout, picks facing-side handles from card geometry (card above → bottom→top; left → right→left;
  dominant axis wins), resolving nested endpoints via rootOf. **Preview-verified** handles persisted:
  500→501 bottom/top, 500→502 right/left, 500→503 left/right (diagonals route around the middle card, no
  cutting through interiors).
- **#4 Direction popover — concrete + collision-safe (`ConnectionEdge` rewrite + CSS).** Abstract
  source/target replaced with real card refs: `No arrow` / `#500 → #501` / `#501 → #500`, plus card-text
  snippets and the label. Popover floats above the badge (`z-index:1200`, verified above cards) with a
  bright amber CSS tether (`::after`) back to the on-edge badge. Edge-label layer raised so it's never
  hidden behind a card.
- **#5 Badge staggering — `badgeOffsets` memo + `endpointCenter`.** Edges whose midpoints bucket together
  get perpendicular offsets so nearby badges separate. **Preview-verified**: 3-edge fan already separated;
  a forced parallel 500↔501 pair lands its two badges apart, not stacked.
- **#1 follow-up fix (user-reported): directed edges respect the user's orientation.** The user had #57
  level with and to the RIGHT of #12 (a lateral relationship), but the edge was `source_to_target`, so
  `buildRootLayoutModel` unconditionally made it a Dagre rank edge → #57 was forced into the rank below
  #12. Fix: an edge becomes a VERTICAL rank edge only when the user actually placed the target with a
  meaningful vertical gap (`> 0.6 * max card height`); an edge laid out level stays lateral (same rank),
  so #57 stays beside #12 in user x-order. Direction metadata now only orients (which card on top) and is
  a fallback when positions are absent (new cards / the position-free unit tests). Lateral nodes with no
  vertical edge of their own would float to rank 0, so `snapLateralNodesToNeighborRank` seats each onto
  its ranked neighbor's rank after Dagre (tried Dagre `minlen:0` first — it throws, silently hit the
  fallback grid and collapsed all ranks; snap is the robust path). Preview-verified on the user's 8-card
  layout: #57 same rank as #12, to its right, edge routes right→left. Regression test added.
- **#2 follow-up fix (user-reported): tree routing, not raw dominant-axis.** After auto-clean, the
  #12→#57 edge exited #12's *side* and stacked on the same side as #12's incoming edge, because #57 was
  farther left than below and the old `|dy| >= |dx|` rule chose horizontal. Fixed `computeConnectionHandles`
  to be rank-aware: any two cards with a real vertical gap (>= half the shorter card's height) route
  bottom-to-top, so a card's incoming edge enters its top and its outgoing edge leaves its bottom; side
  handles only for same-height siblings. Preview-verified on the user's 8-card layout (all edges now
  bottom/top; #12 incoming top, outgoing bottom). Regression test added (diagonal-down child → vertical).
- **Known minor**: a handle-less parallel edge (only reachable by direct snapshot injection, not by
  user-drawn connections which get staggered handles from `connectionHandlesFor`) can drop its badge near
  the source card. Cosmetic, test-only artifact; left as-is.
- **Env note**: `vite.config.ts` now honors a `PORT` env override (preview tooling) but still defaults to
  5181 with `open` for normal `npm run dev` — restored after the preview session. `.claude/launch.json`
  has `autoPort:true`.
- **Remaining from the handoff (not started this session):** #2's badge-vs-card-rectangle avoidance
  beyond staggering; deeper popover free-space collision search (current high-z + float-above solves the
  "hidden under card" complaint). #3/#6/#7 were done during the quota gap — not re-touched.

## Judgment calls deferred to user (do not act)
1. reference_confirmation swallows a NEW explicit command until the user answers yes/no/cancel/names a
   card (connection_label got a command-precedence escape in `a207501`; reference_confirmation did not).
   Exits exist (no/cancel/override), so not a wedge — extending command precedence there is a UX call.
2. activeSelectionContext persists until the next mirror or large turn (advisory-only; feeds acceleration
   evidence + LLM ctx). Clearing it on move-on/topic-pivot would be tidier but changes coaching behavior.
3. clearChatOnly (App.tsx ~3309) replaces the whole LoopState with a fresh empty bank while the MAP (and
   `confirmed[]`) persists — surviving cards' provenance utterance ids point into the discarded bank.
   Go-forward writes still share the one live bank, so no invariant break, but provenance display for old
   cards dangles. This is the previously deferred item E; needs a product decision (re-seed bank from map
   texts on clear-chat, or accept dangling provenance).
4. pendingChildPlacement is ARMED by parsing the AI's OWN question wording (childPlacementRequest); the
   user's next free-text answer is minted directly as a nested card with no confirm step. Card text is
   user words and the placement was named in the question, so it's arguably consented — but it is the one
   flow where AI question-wording chooses the parent. Deliberately shipped in `3d64f10`; leaving as-is.
5. "#448 should link to #451" (declarative-shaped but #ref-pair) still executes as a command — existing
   test pins this as deliberate; my new declarative gate exempts #ref pairs to preserve it.
