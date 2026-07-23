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

   **Checkpoint 1 review — `f0c99d3` on the feature branch (ACCEPTED
   2026-07-23).** Independently verified by Claude: `tsc` clean, full 281-test
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

   Next: checkpoint 2 (original-language coach context and persistence) per
   the pass doc.

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

7. **[POST-MERGE] `App.tsx` decomposition** (~4,700 lines): `useMindmapSession`
   hook, `session-persistence.ts`, `ControlRoom.tsx` fed by a diagnostics
   selector. Only when no parallel mindmap branch is mid-flight.

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
