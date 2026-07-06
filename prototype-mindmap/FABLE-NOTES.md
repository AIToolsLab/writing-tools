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

## Review pass over the gap-landed work (2026-07-05, third session)

Scope: review + fix-as-you-go of everything landed between `20c20b6` and `74b71b8` (open-threads,
edit_card, off-ramps, dismiss ideas, row-preserving auto-clean, generalized command precedence,
stale-pending guard, sanitizeClarifySpan, typed mirror override). Baseline 537/537 → final 540/540,
tsc + vite build clean.

Fixed this pass (each with a regression test where behavioral):
- R1 open-threads activation hijack: thread matching is deliberately loose (one shared topic word =
  0.5 overlap on a 2-token thread), and it fired on EVERY compact turn — an ordinary answer sharing a
  word with an old parked phrase could retarget `activeSelectionContext` + mark the thread active.
  Now only return/pivot-shaped turns (`looksLikeThreadReturn`) or literal restatements activate, and
  direct-command turns never do. (controller.ts `activateMatchingParkedThread`)
- R2 question-shaped edit hole: LLM-emitted `edit_card` was not dropped on question-shaped turns
  (only create_card was), and `isUncertainExplicitPlacement` was missing the modals `could`/`shall`
  that `isQuestionShapedCommandTurn` has — so "Could #10 say human oversight" (voice, no "?") could
  execute a model-emitted edit. Both aligned; card WRITES (create+edit) now dropped on question turns.
- R3 raw internal id leak (transcript bug): "That seems close to tu_10 ... edited/reworded?" showed
  the internal unit id and offered an action that then had no path. Now cites the #ref and names the
  fulfilling command ("You can say: reword #N to <your exact words>").
- R4 capability off-ramp misses (transcript bug): "can you reword a card" / "are you capable of
  rewording a card?" fell through to the coach loop (only "are you able to ... edit cards" matched).
  Detector broadened to capability-verb + card phrasings; answer text now names the reword command.
- R5 mojibake regexes: two `[â€™']` character classes (UTF-8 corruption of `[’']`) in
  detectTypedModeOverride / detectOffRampResponse.
- R6 dead block: the connection_label-specific command-precedence check was unreachable after the
  generalized precedence guard landed; removed.
- R7 fuzz harness taught about edit_card: MUTATION_KINDS (UTH read-only invariant), authorship check
  on `edit_card.text`, an adversarial LLM edit attack (invented replacement wording must be blocked),
  and a legit "reword #N to <words>" user-input category.

Verified airtight in the new work (no action): edit_card acceptance gates mirror create_card
(resolve + named-this-turn + exact current-turn replacement via word-boundary `textContainsExactPhrase`
+ cited-id check); commandConsumedUtteranceIds covers edit_card; sanitizeClarifySpan applied at both
clarifyTarget set-points; stale-pending guard drops confirmations whose cards were deleted; UTH/trace/
App ack/api prompt all cover edit_card; dismiss wiring (App ✕ → dismissedCandidateIds, persisted,
cloned, cleared with state) emits zero map writes.

## Weird-input lane (2026-07-05, fourth session) — the two-channel "aware, not fenced" design

User + reviewer green-lit the LLM meta-lane, but the ORIGINAL binary (meta OR coach) would have
fenced the AI from noticing exhaustion on a productive turn. Fixed by splitting into TWO channels so
awareness is never gated out — only STRUCTURE is fenced. Decisions: soften + drop map-ward pushes
(no proactive pause); LLM + deterministic floor. 549/549 green, tsc + vite build clean.

- **Channel 1 — `metaIntent` (pure aside, fenced).** New `LLMTurn.metaIntent`
  (emotional|confused|social|off_topic|unparseable). Honored only when the turn is clearly not real
  work: `!command && !userAnsweredLastQuestion && !inCardCapture && !looksLikeSubstantiveAnswer` (the
  last is the reviewer's mixed-turn guard — a "frustrated but here's my real point" turn is coached,
  never discarded). When honored: return BEFORE candidate application and command routing (structure
  can't leak), mark the utterance `nonHarvestable` (new flag, NOT `commandOnly` — reviewer's point),
  preserve clarifyTarget/activeElicitation/lastCoachQuestion so a brief aside doesn't wipe the thread.
  `suppressionReason: "meta_aside"`.
- **Channel 2 — `affect` (tone/pacing modifier, NEVER fences).** New `LLMTurn.affect`
  (exhausted|frustrated|overwhelmed|energized) settable on ANY turn including productive ones, plus a
  deterministic floor (`DRAINED_PHRASES` + `LLMContext.userSeemsDrained`) that can only ASSERT drained,
  never force harshness. When drained, `mirrorPressureHigh` and the draft-`salienceBridge` are switched
  OFF — i.e. genuine "this person is tired" recognition removes the two brittle map-ward pushes instead
  of code forcing them. This is the crux of honoring the user's "don't fence awareness" value.
- **Capabilities manifest** (`config.capabilities.canDo/cantDo`) — product truth injected into the
  prompt so meta/capability answers stay honest instead of model vibes; `LLMContext.capabilities`
  optional (api falls back to config). Deterministic capability/authoring off-ramps kept as the reliable
  fast path; the soft meta-repair off-ramp now also defers to coaching on substantive turns.
- **Post-review hardening**: deterministic capability answers now render from the manifest instead of
  hardcoded copy; unsupported feature asks such as card styling/color/export route to the hard
  capability off-ramp before the LLM, so no smuggled candidates/commands can be harvested; and a pure
  `meta_aside` no longer clears `pendingCardWording`/`captureLoop`, so a quick "ugh" during card-capture
  does not wipe the exact wording the user already supplied.
- **Second bug sweep**: `nonHarvestable` now propagates through the async live-bank merge and is excluded
  everywhere source material is rendered or re-derived (`api` Source Bank prompt, focus-help bank anchors,
  App readiness snapshot, and UTH idea labels). This closes the read-side leak where a fenced aside could
  still appear as ordinary source context even though controller harvest/mirror gates excluded it.
- **Enforcement**: `mirrorEligibleBank` excludes `nonHarvestable`; `store.markNonHarvestable` added;
  api parser whitelists the two enums; question-shaped turns already drop card writes. Fuzz harness:
  adversarial mock now sets metaIntent+affect while smuggling create_card + candidateUpserts → I7
  invariant asserts a `meta_aside` turn carries zero map commands; mirror re-validation now excludes
  nonHarvestable too. Tests: pure-aside fenced, mixed-turn NOT honored, drained-floor drops the
  mirror-pressure push.
- **Deferred / minor**: (a) a meta aside during a pending confirmation gets the "still pending"
  reprompt (pending handlers run pre-LLM), not a warm aside — safe, nothing lost. (b) The substantive
  backstop is a coarse >=3-content-token line; it errs low-cost both ways and the LLM's metaIntent is
  always required, so no code-only fencing. (c) UTH keeps its last snapshot on a meta aside (no
  rebuild), consistent with the deterministic off-ramp — a plain in-panel event is still a follow-up.

## Review pass over the weird-input lane + reviewer fixes (2026-07-05, fifth session)

Reviewed the landed reviewer-fix code (unsupported-capability detection, manifest-driven answer,
meta-branch no longer clearing capture state — all confirmed present) plus the full off-ramp / meta /
affect surface. 550/550 green, tsc + vite build clean.

- **R-fix (real bug): capability off-ramp hijacked writing subject matter.** `isUnsupportedCapabilityAsk`
  treated bare `style|color|theme|layout|appearance|font|background|bold|italic` as app-feature asks, so
  a *writing* turn — "can you tell me if my **style** is clear", "**color** theory matters in my essay",
  "make my writing **style** clearer", "the central **theme** of my essay" — got hijacked into the
  capability off-ramp and its content discarded (`commandOnly`). Tightened in two rounds: (1) an
  appearance word must co-occur with an unambiguous MUTATION verb (make/change/set/turn/... — `style`
  and `color` no longer count as the verb); (2) narrowed `appearanceWord` to unambiguously-visual terms
  only (`colou?rs?|blue|red|green|purple|font|fonts|layout`), dropping style/theme/appearance/background/
  bold/italic. All pinned cases still fire ("make cards blue", "change the layout", "export this map");
  new regression test covers 5 writing-content phrasings that must reach the coach and stay harvestable.
- **Verified sound (no change):** meta lane fence returns before candidate/command routing;
  `nonHarvestable` wired symmetrically (understanding.ts label sourcing, App.tsx bank merge OR-both-flags,
  App.tsx understanding-bank filter); affect suppression gates only the two map-ward pushes
  (mirror-pressure + draft-salience) and leaves the explicit user-asked list bridge alone; deterministic
  off-ramp precedence over the LLM meta-lane is clean (off-ramp returns pre-LLM); trace catalog has
  meta_aside so the header chip renders.
- **Minor, left as-is:** "can you write my thesis" (a content-authoring ask) isn't caught by the
  deterministic authoring off-ramp because `thesis` isn't in its target-noun list — but the LLM layer
  (manifest in prompt) declines it and no content is authored (enforcement holds), so it's an honesty-UX
  gap, not an enforcement hole. "change the layout"/"export this" remain intentionally map-interpreted
  per the pinned tests; a rare "change the layout of my essay" could still be mis-caught.

## Judgment calls deferred to user (do not act)
1. ~~reference_confirmation swallows a NEW explicit command~~ RESOLVED in the gap work: generalized
   command precedence now preempts any pending kind (with a cancel guard).
1b. Off-ramp ordering: a meta-repair phrase ("that's wrong") while a confirmation is pending CLEARS the
   pending command and reorients, instead of routing to the near-match rejection/correction flow. Safe
   (nothing executes) but lossy — the user must restate the command. Deliberate in the gap work (it has
   its own test), so left as shipped; flagging the trade-off.
1c. Dismissed-idea resurrection is LLM-gameable: un-suppression only requires the upsert to cite ANY
   this-turn utterance, so a pushy model can revive a dismissed candidate off an unrelated turn.
   Consequence-bounded (readiness/validator/confirm still gate; panel is read-only). A stricter
   "re-articulate" check would need vocabulary overlap between the fresh turn and the dismissed idea.
1d. The agreed "fenced LLM meta-lane" for emotional/general-weird input shipped as DETERMINISTIC
   templates instead (annoyed/frustrated/confused/"that's wrong" → fixed repair copy). More conservative
   than the decision, but general-weird input still falls to the normal coach loop with no special
   prompt note. Fine for demo; revisit if off-distribution turns still feel mechanical.
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
