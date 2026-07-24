# Agent Handoff — Mindmap Prototype

Last updated: 2026-07-23 America/New_York. Tracked successor to the old
untracked `CODEX-HANDOFF-next-chat-untracked.md` (retired). Audience: any
agent or human building features on `mindmap-main`.
This doc tells you what's here, **what is about to land** (so you don't
collide with it), and what must never change without asking.

Prototype path: `prototype-mindmap/`

## Read first (in order)

1. `prototype-mindmap/docs/DESIGN.md` — canonical invariants (current).
2. `prototype-mindmap/docs/airtightness-report.md` — enforcement appendix.
3. `prototype-mindmap/docs/refactor-plan.md` — staged rationale + resolved decisions.
4. Pass docs:
   - `docs/stage-4-eval-harness-pass.md` — the ACTIVE eval track.
   - `docs/multilingual-grounding-pass.md` — the pass IN FLIGHT right now.
   - `docs/stage-1_5-fix-pass.md` — historical; context for recent changes.

## Current verified state (HEAD `9ec90e6`)

Stage 1/1.5 typed-proposal runtime, all three assistance contracts (L0/L1/L2),
passive draft anchors, immutable draft snapshots, controlled recall, terminal
recovery, L1 draft-grounded mirrors, three-tier provenance
(`user_asserted` / `ai_connected` / `ai_suggested`), sticky suggestion-adoption
tracing (incl. the no-retroactive-adoption boundary fix), and `grounded_recap`
are complete. The legacy regex controller is deleted.

Verification at this checkpoint: `tsc` and eval type-checks pass, 270 Vitest
tests pass, production build passes, browser smoke green. Outstanding: a live
provider run for recap/explicit-nesting and the tuned 20-scenario reportable
eval.

Live pipeline:

```
user input → SourceBank capture → typed AssistantResponse
  → contract allowlist → validator (reflections) / action-gateway (map)
  → proposal shown → explicit user click → gateway applies + audit event
```

Key enforcement files: `validator.ts`, `action-gateway.ts`,
`proposal-store.ts`, `assistance-contract.ts`, `map-store.ts`, `store.ts`.
Orchestrator: `stage1-loop.ts`. Transport: `api.ts` + feature-flagged
`provider-tools.ts` (`chat_json` is the default; keep it so until
`responses_tools` passes a live propose-only smoke run).

## Planned / in-flight work — collision map

If you build on this branch, check this list first. File lists are the areas
each item will touch.

1. **[IN FLIGHT NOW] Multilingual grounding pass** — branch
   `feat/mindmap-multilingual-grounding`, merging back here when its
   checkpoints land green. Spec: `docs/multilingual-grounding-pass.md`.
   Explicit typed-lookup localization (`src/ui-strings.ts` + `src/i18n/*.json`,
   ~35 locales; **no DOM MutationObserver layer**), a `ui-locale` module,
   centralized mutation gating (`mutation-policy`), and edits to `App.tsx`,
   `Map.tsx`, `action-gateway.ts`, `main.tsx`. Grounding profiles: English +
   Chinese first; language-neutral normalizer folds full-/half-width
   punctuation + CJK quotes; Simplified↔Traditional deliberately fails
   grounding; `Intl.Segmenter` zh needs a full-ICU canary test.
   **`origin/feat/mindmap_translation` is a donor only — never merge it** (it
   forked pre-Stage-1 cutover and would resurrect deleted subsystems).
   *Avoid deep edits to `App.tsx`/`Map.tsx`/`action-gateway.ts` until this
   merges — you will conflict.*

   **Checkpoint 1 review — `f0c99d3`, now `7448891` after the rebase onto
   `mindmap-main` (ACCEPTED 2026-07-23).** Independently verified by Claude: `tsc` clean, full 281-test
   Vitest suite passes (exit 0), `zh.json` covers every `source.json` string
   (other locales partial by design, degrade to English), `t()` is applied
   only to UI-string literals in `App.tsx`/`Map.tsx`, and `App.test.ts`
   covers the key trap — authored text `"Clear map"` stays verbatim while
   surrounding chrome localizes to 确认, all buttons disabled in
   `translated_view`. Session schema and provider contracts unchanged
   (`action-gateway.ts` gained only the `read_only_view` reason code).

   *Carry-forward — fold into the checkpoint that makes `translated_view`
   reachable (translation overlay); do not rework now:*
   - **Gateway-level read-only enforcement + rejection feedback.**
     `translated_view` is latent (`main.tsx` hard-codes `mode="authoring"`;
     only tests exercise it), and enforcement is ~30 distributed
     `if (!mutationAccess.allows(...)) return;` call-site checks — a future
     mutation path that forgets the check silently bypasses policy, and most
     App-side rejections are silent early-returns (only Map's `dispatchCanvas`
     returns a localized detail). Before the view ships: (a) also enforce at
     the gateway/store layer — the `read_only_view` reason code exists but
     nothing emits it — or add a test enumerating every mutation entry point;
     (b) give rejected mutations user-visible feedback (reuse the "Switch back
     to the writing view to edit." pattern).
   - **Cleanup (anytime):** `source.json` duplicates `"Enter to send"`
     (lines 35/95), propagated into `zh.json` as a duplicate key — dedupe
     both. `mutationAccess.run("canvas_edit", captureMapUndo)` (`App.tsx`
     ~3241) files undo-capture under `canvas_edit`; give it its own intent or
     reuse `map_undo`. Cosmetic.

   **Checkpoint 2 review — original-language coach context (ACCEPTED
   2026-07-23; commit before starting checkpoint 3).** The feature branch was
   rebased onto `mindmap-main` (`ff2b165`) first, with the three colliding
   untracked pass-doc copies removed. Independently verified by Claude: `tsc`
   clean, 291 Vitest tests pass, build green. Landed per the agreed
   checkpoint-2 plan and its four review amendments:
   - `src/language-context.ts` — advisory script-pattern classifier
     (`single | mixed | unknown`); Han/Hiragana/Katakana/Hangul/Bopomofo are
     one CJK family, so monolingual Japanese and Korean-with-Hanja classify
     `single`; an unfamiliar letter script returns `unknown` rather than
     guessing (tested with Ge'ez). Decided edge: Latin + unfamiliar script
     also returns `unknown`, not `mixed`.
   - `LLMContext.language` (`LanguageContext`) threaded through
     `buildContext`/`processTurn`; `latestUserLanguagePattern` persists in
     `ConversationState`/`PersistedSession` (legacy sessions default
     `unknown`), updates only on non-empty user turns, and survives clone,
     coach-only continuation, and reload. `uiLocale` comes from
     `useUiLocale()` per call and is never persisted.
   - Rendered context labels `uiLocale` "presentation-only … not a
     response-language preference"; the system prompt adds original-language
     preservation guidance and "the interface display locale is never an
     instruction to translate or change reply language". Both test-asserted.
   - The validator-independence test pins the advisory invariant: identical
     valid and invalid claims produce byte-identical validation outcomes
     under all three forced pattern values. **Checkpoint 3 must keep this
     test passing untouched — grounding may not consult the pattern field.**
   - `preferredCoachLanguage` stays an unused extension point; a direct
     language request remains ordinary authored conversation (test-pinned).

   **Checkpoint 3 review — English/Chinese exact-phrase grounding (ACCEPTED
   2026-07-23; commit before starting checkpoint 4).** Independently verified
   by Claude: `tsc` clean, 311 Vitest tests pass, build green, plus a full
   audit sweep (regex inventory, consumer-by-consumer regression trace,
   rigidity assessment). What landed:
   - `normalize.ts` rebuilt: NFKC + smart-quote/corner-bracket folding
     (`foldWidthAndQuotes`), `Intl.Segmenter` word tokenization (zh segmenter
     when any CJK present, full-ICU canary test), grapheme-accurate
     **code-owned offsets** (`findWholePhraseRange` maps folded matches back
     to UTF-16 ranges in the unchanged original — the model never computes
     offsets), `stem()` identity for non-Latin, closed zh particle list in
     STOPWORDS. Shared `CJK_SCRIPT_RE` extracted to `unicode-scripts.ts`.
   - `validator.ts`: span grounding is now binary exact-phrase presence
     (`containsWholePhrase` after folding), and lexical grounding draws from
     the **cited evidence phrases** (`citedPhraseStemSet`), not whole cited
     utterances. Citation is verbatim (mod folding); mirror prose keeps
     stem-level inflection freedom for English. Simplified↔Traditional
     substitution deliberately fails (test-pinned). The checkpoint-2
     advisory-invariant test is untouched — the validator imports nothing
     from `language-context`.
   - One regression was caught in review and fixed: `segment()` briefly split
     ASCII `.!?` without following whitespace, corrupting English SourceBank
     units (`3.5`, `example.com`); now only CJK `。！？` split without
     whitespace, with regression tests pinning decimals/domains/parenthesized
     punctuation. Known cosmetic nit (decided, not a bug): a CJK terminator
     inside quotes splits before the closing `」`; fix if ever needed is
     `(?<=[。！？])(?![」』"'）])`.
   - `spanGroundingMin` semantics clarified in `config.ts` (span scores are
     binary; the threshold governs relational same-utterance coverage only).
   - **Acknowledged intended rigidity:** mirrors are stricter in both
     languages — content words must come from cited phrases, citations must
     be exact. All new rigidity gates the AI, never the user. Watch-item
     recorded in the pass doc: compare the **English** first-pass
     grounded-mirror rate against the pre-checkpoint-3 baseline in Stage 4;
     if it drops materially, tune the prompt to cite more precise evidence —
     never loosen the validator.
   - Documented later-cleanups (not now): the redundant whole-utterance
     stem-ratio path in `claimRelationStatedInOneUtterance` (strictly weaker
     than the phrase-based lexical check, harmless), and the Japanese
     per-grapheme NFKC composition edge (ja is not a grounding target).
   - Silent improvements worth knowing: Chinese turn-shape token counts and
     suggestion-adoption overlap were previously near-meaningless (a whole
     zh sentence tokenized as one blob) and are now real.

   **Next: checkpoint 4 — explicit translation behavior** (pass doc §8;
   product decisions RATIFIED 2026-07-23, recorded there). Two slices, each
   landing independently green:

   **4a — coach translation response (build first).** The
   `TranslationResponse` kind (`ai_translated`, visibly labeled, never a
   grounded reflection, never auto-entering the SourceBank or the map).
   Decided: the request is **model-classified + schema-validated** — a direct
   natural-language ask in chat ("translate that for me" / "把这个翻译成英文")
   yields the labeled translation card; there is **no chat-side Translate
   button**. Misclassification is low-harm by construction (conversational
   only, labeled, enters nothing); add a Stage 4 precision scenario (a turn
   that *mentions* translation without requesting one must not yield a
   translation response). Adoption of translated wording needs no new UI:
   the user typing/saying it themselves makes it authored; a dedicated
   "adopt this wording" affordance is deferred polish.

   **Checkpoint 3 + 4a status: COMMITTED and ACCEPTED** — `028e430` (grounding
   profiles) and `6f4d820` (explicit AI translation) as two separate commits;
   feature branch HEAD is `6f4d820`. 4a independently verified by Claude
   (`tsc`, 316 tests, build) and audited: `translation` kind typed + allowlisted
   at L0/L1/L2, `translation_evidence_not_exact` reuses checkpoint-3
   `containsWholePhrase` so a translation cannot cite a phrase the user did not
   write, `translation_advisory_not_allowed` blocks candidate/affect bookkeeping,
   `invalid_translation_text` pins displayed text == `translatedText`, original
   stays in the SourceBank untouched, visible `AI-translated` badge + dictionary
   key. Two non-blocking notes: the badge reuses the purple `ai-suggestion-badge`
   class (give translation a distinct style in the 4b UI pass), and the
   mention-vs-request precision guardrail is prompt-only pending its Stage 4 eval
   scenario (owed there, not in 4a).

   **4b — reader view.** Everything translated **including user words** →
   read-only, activating `translated_view`. The visible language picker
   lives here (a mode change is a control; a conversational request is not).
   Port the donor display-only overlay (`translate.ts`,
   `translation-memory.ts`, `translation-context.ts`). This slice owns the
   two checkpoint-1 carry-forwards: gateway-level read-only enforcement +
   user-visible rejection feedback, and the `source.json`/`zh.json`
   "Enter to send" dedupe.

   *Control Room in the translated view (ratified):* it is a mixed surface —
   translate app-authored narration/labels/section-titles (chrome), but
   leave machine codes, evidence snippets, and payloads **byte-for-byte**.
   Evidence snippets are verbatim user words shown as audit proof;
   translating one falsifies the audit and breaks the §8 no-translated-user-
   wording rule. Reading surfaces translate for comprehension; the Control
   Room is the fidelity/proof layer and stays raw. Verbatim-with-optional-
   gloss (tooltip beside, never replacing) is deferred, not v1. Full spec in
   pass doc §8 4b.

   **4b browser-QA results (2026-07-23) — DOES NOT COMMIT until 1–4 land.**
   Implementation is otherwise complete and green (`tsc`, 323 Vitest, build),
   and static review confirmed the good parts: gateway now emits
   `read_only_view` for the canvas path, `onRejected` feedback is wired, the
   display cache touches only its own two localStorage keys (never bank /
   session / history / `recordEvent` / `toLLMContext`), protected spans +
   byte-for-byte restore present, dedupe done. Browser QA then found:

   *BLOCKERS:*
   1. **Blank map on reader-language switch.** Console:
      `[React Flow]: The parent container needs a width and a height to
      render the graph` (error#004, ×4). The map container measured
      zero-width/height and React Flow bailed; **data was never lost** (the
      "6 cards" counter stayed correct and a refresh restored everything) —
      this is a render failure, not a mutation. Likely trigger: the reader
      banner is inserted into the layout and reflows the panel containers
      while React Flow measures. The map container needs a height that
      cannot collapse when siblings are inserted.
   2. **The failure is sticky.** Returning to Original view did NOT restore
      the map — `flowNodes` is memoized and `setNodes` syncs via an effect
      whose deps don't change on reader-state change, so an emptied node
      array never recovers until remount (refresh). Needs a re-measure path
      **plus an error boundary — there is none anywhere in the app**, a
      pre-existing gap this exposed.
   3. **`reader-view.tsx` queueing correctness.** `useEffect(() => { void
      flush(); })` has **no dependency array** (runs every render), and
      `translate()` mutates `queued.current` **during the render phase**.
      NOTE: this was initially suspected as the blank-map cause and is *not*
      — `flush` early-returns when the queue is empty or a run is in flight.
      Still fix both: render-phase ref mutation can drop or duplicate queued
      translations (notably under StrictMode double-render).
   4. **Regression test:** map node count identical before / during / after
      a reader-language switch. Current tests do not cover it.

   *POLISH (same pass):* the read-only banner reuses `className="error-banner"`
   so a `role="status"` message wears the error skin — give it its own calm
   informational class; the top toolbar does not wrap/overflow, so the new
   Reader-language selector makes controls overlap when the panel is slid with
   Control Room open; give the `AI-translated` badge a distinct style (it
   currently reuses the purple `ai-suggestion-badge`, indistinguishable from
   AI suggestions).

   *VERIFIED WORKING in QA:* checkpoint-2 language matching is excellent —
   the coach held a full conversation in **Twi** (no grounding profile, no
   dictionary), including mixed Twi/English turns, and answered Spanish in
   Spanish. Reader translation itself worked (chat projected to Bengali).
   Translation-half QA should be re-run after the fixes; the earlier
   `Backend 401` was an unrelated stale backend process holding port 8000.

   **Considered and REJECTED (do not re-propose without new evidence):** a
   third "coach-language" mode (chrome + coach speech translated, user words
   untouched, editable). The mainstream case is already covered — the coach
   follows the user's turn language natively (checkpoint 2), so the normal
   screen is monolingual with zero translation; the niche
   write-in-X-coached-in-Y case is reachable today via the conversational
   override ("honor a direct user request for another response language"),
   which does not persist across reloads — if users complain about
   re-asking, that is the demand signal to wire the reserved
   `preferredCoachLanguage` picker (build then, not now). Back-translating
   *historical* coach messages is rejected outright: it needs the runtime
   engine plus span-level care for embedded verbatim user evidence (mirrors
   must never display translated user wording), and buys retroactive
   transcript consistency that human conversation doesn't have either.

2. **[SPEC AGREED] Graceful reflection recovery + staged progress** (Parts A+B
   ship together, before the reportable hand-scoring pass). Capped
   mirror → informed-repair → forced-question ladder (≤3 model calls; only the
   `reflection_validation_failed` path escalates — every other rejection keeps
   single-repair) + event-driven progress line in chat (plain-language copy;
   jargon stays in the Control Room). Files: `stage1-loop.ts`, `api.ts`,
   `validator.ts` (expose ungrounded words), `App.tsx`, tests. Also update the
   "exactly one repair" wording in `refactor-plan.md` when it lands.

3. **[SPEC AGREED — ships with 2] Mirror faithfulness: zero ungrounded content
   words.** An `asserted` reflection's displayed claim text must contain no
   content tokens absent from cited sources (kills meaning-shifting adds like
   "necessarily"). No hedging word-bank. Prompt tells the model to aim for it;
   the validator is the backstop. First-pass grounded-mirror rate becomes a
   model-capability metric in the Stage 4 harness.

4. **[AGREED TODO] Chat anchor for draft-grounded reflections.** A reflection
   citing draft-origin evidence must also cite ≥1 chat-origin utterance
   (`reflection_draft_without_chat_anchor`); pure-draft mirrors are rejected.
   Check sits beside the `citesDraft` gate in `createProposal`.

5. **[ACTIVE] Stage 4 eval:** run the fixed 20-scenario L0-vs-L2 suite live,
   retain all transcripts, hand-score the designated 40 outcomes
   (grounded-mirror rate, recovery stages, terminal failures, directiveness,
   attribution, question premises, quotation confusion, latency, tokens).
   Manipulation checks must also run in Chinese once (1) lands. LLM-judge
   automation comes only after hand-scoring.

6. **[POLISH] "AI suggestion · 0%" relabel** — surface `peakOverlapRatio`
   ("was AI-suggested" / "AI-influenced") when current overlap has decayed.
   Demo-facing.

6b. **[BUG — pre-existing, found in 4b QA 2026-07-23] Map provenance panel
   layout.** The Control Room's provenance rows render one word (or one CJK
   character) per line with the counts misaligned. Cause: `.event-row` is
   `display: grid; grid-template-columns: 24px 1fr auto`, expecting a leading
   icon cell, but the provenance rows supply only two children — so the label
   lands in the **24px** column and is crushed. Present on `mindmap-main`;
   4b never touches it. Fix: give these rows a two-column variant
   (`grid-template-columns: 1fr auto`) plus `min-width: 0` on the title.

6c. **[BUG — Part B deviation, found in 4b QA 2026-07-23] Turn-progress
   narration is scripted, not event-driven.** `App.tsx` sets
   `setTurnProgress("initial_attempt")` unconditionally at the start of every
   turn (~L4021 and ~L4075), before any model call, so "Trying to reflect
   your words…" shows on **every** turn. This contradicts the agreed Part B
   spec ("show a stage only when it actually happens; a turn whose first
   mirror grounds shows little/none; narration appears exactly when the
   multi-attempt path runs"). Two harms: it is repetitive enough to stop
   carrying information, and it is often **inaccurate** — at that moment the
   model has not chosen its move, so turns that end as a question, answer,
   aside, or suggestion were all announced as reflections (observed live on
   plain-answer and question turns). Fix: drop the eager `initial_attempt`
   and reserve narration for stages that genuinely occur
   (`grounding_repair`, `forced_question`). If a bare spinner feels dead,
   show a delayed (~600–800ms) indicator with **neutral** copy instead of
   claiming a reflection. Confirm what plain `loading` renders on its own
   before removing the stage, so fast turns keep some feedback.

7. **[POST-MERGE] `App.tsx` decomposition** (**4,852 lines** on
   `mindmap-main`; 4,941 with 4b in the working tree — the "~4,700" figure
   was stale): `useMindmapSession` hook, `session-persistence.ts`,
   `ControlRoom.tsx` fed by a diagnostics selector. Only when no parallel
   mindmap branch is mid-flight (4b is mid-flight now, so it cannot start
   yet).

   **Sequencing (recommended 2026-07-23): do this BEFORE Checkpoint 6, not
   after.** Checkpoint 6 adds two large surfaces to this same file — the
   Recap panel (6b) and the compare-3-levels UI (6c) — so building them into
   a ~5,000-line component makes both the implementation and its review
   harder, and every checkpoint so far has grown the file further. The 4b QA
   also strengthened the structural case: the blank-map failure came from
   layout fragility in this file, and there is **no error boundary anywhere
   in the app**. The `ControlRoom.tsx` extraction in particular would isolate
   the provenance-grid bug (6b above) and the Control Room translation logic.

8. **[AGREED 2026-07-23 — POST-4b] Checkpoint 6: session digest + donor
   reclamation.** Reclaim three donor features
   (`origin/feat/mindmap_translation`, donor-only, never merge) plus one new
   deliverable. Ranked slices, each landing independently green.
   **Prerequisite (recommended): land item 7's `App.tsx` decomposition first**
   — 6b and 6c are both large additions to that file. See item 7.

   **6a — `generate-i18n` script (small; may precede 4b, no `App.tsx`
   touch).** Port `scripts/generate-i18n.mjs` + the `i18n` npm script. It
   translates `src/i18n/source.json` into every locale via the backend proxy
   (`npm run i18n [-- --force | <codes>]`). `mindmap-main` has the 34
   dictionaries but not the generator, so every hand-added chrome key
   (checkpoints 1/4a already added some) drifts the files out of sync with no
   tool to regenerate. Low-glamour, high-leverage; port early.

   **6b — session digest engine → Recap panel + exportable report.** ONE pure
   deterministic function `buildSessionDigest(ledger, mapSnapshot,
   sourceBank) → Digest`, rendered two ways. Substrate already exists: the
   `EventLedger` on `mindmap-main` records timestamped typed events
   (`contract_selected` = level switches, `assistant_response`,
   `proposal_created/resolved`, `map_mutated`, `candidate_lifecycle_changed`,
   `suggestion_adoption_changed`, `application_recovery`, `user_message`) with
   contract snapshot, origin, outcome, response kind, repair count, adoption
   percentages. Rebuild the donor's deterministic `RecapData` concept on the
   *current* provenance fields (do not copy donor internals).
   - **Determinism contract (pin as a test):** pure function of ledger + map
     + bank, **zero AI calls**; same session in → byte-identical output.
   - **Zero AI paraphrase (RATIFIED):** no generated prose anywhere, TLDR
     included. TLDR is **template + deterministic slots** ("14 turns. 6 of 9
     cards are your words. Worked mostly at L1; switched to L2 at turn 7.").
     User content appears only as **verbatim extractive snippets**, never
     paraphrased — a report about authorship must not launder user words
     through an AI.
   - **Render target 1 — Recap panel (user-facing, priority).** Live,
     glanceable Control Room view; both audiences in one panel (writer's
     trajectory + teacher's authorship/AI-usage split).
   - **Render target 2 — exportable report (RATIFIED).** Client-side
     generated from in-memory ledger + state (no backend dependency).
     **Markdown primary deliverable + optional JSON sidecar**; no PDF/docx.
     Sections: TLDR (counts + authorship split + level headline) → usage
     timeline (the `contract_selected` sequence as a turn/level/change table)
     → thinking trajectory (verbatim user turns) → what was built (cards with
     provenance) → optional raw appendix. **Audience: both** (one document,
     both sections — not two exports).
   - Guardrail: the digest is a faithful mirror of what the ledger already
     knows. It must never summarize, score, or analyze — the moment it does,
     it becomes the thing the app resists. Note: an exported copy embeds the
     user's verbatim words (deliberate deliverable; fine in their own report).

   **6c — compare-3-levels (last; heaviest `App.tsx` surface).** Reclaim the
   donor's `compareAssistanceLevels` + `comparisonSystemPrompt` + three-hued
   `.compare3` UI: answer the same user turn once under each of L0/L1/L2, show
   all three, user selects one to continue. **Surface behind a build-time
   feature flag** (`config.ts`, e.g. `features.compareLevels`) — surfaced in
   the UI for demo/dev now, flip the flag to unsurface for prod later (no code
   removal; same latent-behind-flag pattern as `translated_view`). Rebuild the
   plumbing on the current runtime: each level's response crosses the current
   contract allowlist + validator, and "select one" routes the chosen response
   through the current loop (the donor version predates the typed runtime —
   concept/prompt/UI reused, plumbing rebuilt). Surface per-level
   `rejectionReasons` for honesty.

   **6d — port donor e2e specs into checkpoint-5 browser QA.** The donor's
   `e2e/i18n.spec.ts` + `language.spec.ts` (translated-view read-only, only
   writer content reaches the engine, dictionary completeness, chrome re-skin
   without touching the engine) were dropped when `mindmap-main` kept only
   `smoke.spec.ts`. Adapt them against the current `translated_view` /
   `mutation-policy` (not the donor's `language.ts`). Fold into checkpoint 5.

   **Explicitly skip (already decided):** `dom-translation.ts` (no DOM
   MutationObserver layer — pass uses typed lookup), donor `language.ts`
   write/view model (superseded by `ui-locale` + 4b reader view),
   `open-threads.ts` (deliberately deleted from `mindmap-main`; do not revive).

## Deferred (do not start unless asked)

LiveKit/voice-native conversation; fast map mode (draft → proposed cards,
opt-in only); save/export/multi-user collaboration.

## Product philosophy (binding — ask before deviating)

The user authors ALL map structure; the AI questions and reflects only.
Validation gates the AI, never the user. The map changes only from explicit
user commands/confirmations. Recall is bounded influence: user-verbatim text,
confirmed placement, logged (`InfluenceTrace`); code never decides the user
"returned" to a topic. No provider tool may confirm/apply/persist/stage —
everything routes through the gateway. If a bug exposes a philosophical
choice, recommend and ask Nhyira; do not decide unilaterally.

Working preferences: demo-ready behavior first (UIST-style demo/poster);
verify behavior yourself; plain-language honesty in chat, machine detail in
the Control Room; no stale/repetitive coach wording.

## Environment notes (Windows)

- Use `npx.cmd` / `npm.cmd`.
- Verify from `prototype-mindmap/`: `npx.cmd tsc --noEmit`,
  `npm.cmd test -- --run`, `npm.cmd run build`, `npm.cmd run eval`.
- Vitest may report all assertions passing yet exit `1` with
  `[vitest-worker]: Timeout calling "onTaskUpdate"` after the long fuzz run —
  a runner/IPC artifact, not a failure. Say so explicitly when it happens.
- Commit/push hooks may fail with `/usr/bin/env: 'sh': No such file or
  directory`; use `git -c core.hooksPath=NUL commit ...` **only after**
  tests/build have run.
- The `eval/runs/` transcripts are data — keep them untracked.
