# Polish sweeps — Codex parallel-work spec

Status: **LANDED 2026-07-24 (implemented directly on `mindmap-main`, not via
Codex branches).** All three items committed and green (tsc / 335 Vitest /
build). B1 = `7b6d0c5`, B2 (with 6c finalize) = `07c89f4`, 6a = `aaaadcb`.
The one deferred check: 6a's **live-backend translation smoke** (needs `:8000`
up) — the dry-run passed, the fetch/write logic is donor-identical. The rest of
this doc is retained as the implementation record. (6b and the cache
eviction/purge were already done before this pass; see "Already done" below.)

**SEQUENCING (do this first).** The 6c narration change is **uncommitted** in the
working tree and edits `src/i18n/source.json`, `src/i18n/zh.json`, and
`App.tsx`. Branch B2 below also edits all three (adds `"was AI-suggested"` to the
same two dict regions; edits `App.tsx`). **Commit 6c before Codex branches**, so
the polish branches fork from a tree that already contains 6c — otherwise B2 and
6c collide in the i18n arrays. Branch A also reads `source.json`; harmless, but
same reason to sequence after 6c lands.

Verify from `prototype-mindmap/` (Windows): `npx.cmd tsc --noEmit`,
`npm.cmd test -- --run`, `npm.cmd run build`. Commit only after green. If the
pre-commit hook dies on `/usr/bin/env: 'sh'`, use
`git -c core.hooksPath=NUL commit ...` **after** the checks pass. Vitest may
print all-pass yet exit 1 with the `onTaskUpdate` timeout after the fuzz run —
that is the known IPC artifact, not a failure; say so if it happens.

## Already done — do NOT re-implement (verified in code 2026-07-24)
- **6b provenance-grid layout** is fixed. `App.tsx` already carries
  `.event-row.provenance-row { grid-template-columns: minmax(0, 1fr) auto; }`
  and `.event-row.provenance-row .event-title { min-width: 0; }` (~lines
  2144–2146; styles are an inline `<style>` block in `App.tsx`, there are no
  `.css` files). Matches the handoff's "provenance-row grid fixed (was 6b)".
- **Reader display-cache FIFO eviction + purge-on-clear** are done.
  `reader-view.tsx` has `READER_DISPLAY_CACHE_MAX_BYTES` and a FIFO append that
  drops oldest-first (~lines 8, 106–123), and `reader.clearDisplayCache()` is
  called from `clearMapOnly`/`clearDraftOnly`/`clearChatOnly` (`App.tsx` ~4344/
  4361/4374). The cache is already successful-results-only. The *only* residual
  is the cap value — see Branch B item 1.

---

## Branch A — 6a: port the `generate-i18n` script (isolated; parallel)

`mindmap-main` has the 34 locale dictionaries but not the generator, so every
hand-added chrome key (checkpoints 1/4a/6c added several) drifts the files out of
sync with no tool to regenerate. Port the donor's generator.

- **Source (donor, reference only — never merge the donor branch):** find it on
  `origin/feat/mindmap_translation` with
  `git show origin/feat/mindmap_translation -- '*generate-i18n*'` (the donor
  path is under its `prototype-mindmap/scripts/`). Also port its
  `src/i18n/README.md` if one exists there.
- **Deliverable:** `scripts/generate-i18n.mjs` + an `i18n` script in
  `package.json` so `npm run i18n [-- --force | <codes>]` works. It translates
  `src/i18n/source.json` into every locale via the backend proxy.
- **Adaptation (critical — the donor predates the current runtime; the donor
  script was read 2026-07-24, these are the real deltas):**
  1. **BLOCKER — locale list.** The donor `supportedLanguages()` parses
     `export const LANGUAGE_CODES = [...]` out of **`src/language.ts`**. That
     module does **not exist on `mindmap-main`** (the donor `language.ts` is on
     the explicit-skip list) and there is **no `LANGUAGE_CODES` constant
     anywhere** — `mindmap-main` discovers locales at build time via
     `import.meta.glob("./i18n/*.json")` in `src/ui-strings.ts`. So the donor
     script throws immediately. **Fix:** rewrite `supportedLanguages()` to
     enumerate the existing `src/i18n/*.json` filenames (excluding
     `source.json`), e.g. read the `i18n` dir and strip `.json`. This keeps the
     34 existing dictionaries in sync with `source.json`; introducing a **new**
     locale is done by passing it explicitly (`npm run i18n -- <newcode>`), which
     the `only` arg already supports. Do NOT recreate `language.ts` or a
     `LANGUAGE_CODES` constant just to satisfy the script.
  2. **Endpoint/body — already matches, minor deltas.** Donor posts
     `POST {BACKEND_URL}/openai/chat/completions` with
     `{ model, messages, stream:false, response_format:{type:"json_object"} }`,
     `BACKEND_URL` default `http://localhost:8000/api`, `MODEL` default
     `gpt-5.6-terra` (via `VITE_MINDMAP_MODEL`). This is correct for the current
     backend — leave it. Optionally add `reasoning_effort` for parity with
     `api.ts`; not required (proxy passthrough). `source.json` is a JSON **array**
     and `<code>.json` an **object** map on both branches — format matches, no
     change.
  3. **Drop donor-specific prompt copy.** The donor system prompt hard-codes
     `Leave the button name "Out" in English` — `mindmap-main` has no such
     button. Remove that line; keep the "short interface copy / preserve leading
     symbols / exact count in input order" guidance.
  4. Port **only** the script (+README). Do not pull any donor runtime module
     (`language.ts`, `dom-translation.ts`, `translation-*.ts`) — rejected in
     AGENT-HANDOFF.md.
  5. The script needs the backend running (`:8000`) to translate. It already
     errors clearly on a non-OK response and per-locale; keep that, keep the
     `--force`/`<codes>` selectors and the batch size (25).
- **Do NOT run a full regeneration in this pass** — that re-bills every locale
  and rewrites 34 files. Land the tooling; a targeted `npm run i18n -- zh` (or a
  dry-run/`--help`) is enough to prove it works.
- **Verify:** `tsc`/tests/build unaffected (it is a standalone build script, not
  imported by the app). Confirm `package.json` `i18n` script parses and the file
  runs under Node without the app bundle.

---

## Branch B — App.tsx / reader-view sweep (one branch; two items)

Both touch `App.tsx`/`reader-view.tsx`; keep them on a single branch to avoid the
merge collisions AGENT-HANDOFF.md warns about (`App.tsx` is ~4.9k lines).

### B1 — reader display-cache cap bump (one line)
FIFO eviction + purge-on-clear already exist (see "Already done"). Nhyira's
decision (2026-07-24): **FIFO, ~1 MB cap.** Current is 512 KiB.
- Change `READER_DISPLAY_CACHE_MAX_BYTES` in `reader-view.tsx` (~line 8) from
  `512 * 1024` to `1024 * 1024` (1 MiB — still well under the ~5 MB localStorage
  quota).
- If a test pins the 512 KiB value or an eviction boundary, update it to the new
  cap. No other logic changes — do not touch the FIFO/purge code, it is correct.

### B2 — "was AI-suggested" relabel (item 6)
**Goal:** when an AI-influence signal has **decayed**, stop showing a bare
`· 0%` and instead label it past-tense. Nhyira's decided copy (2026-07-24):
**"was AI-suggested"**.

**First, confirm the target surface (two candidates — the item is about whichever
shows the misleading zero):**
1. **`InfluenceBadge`** (`App.tsx` ~4793–4801) renders
   `Echoes coach{pct === undefined ? "" : ` · ${pct}%`}` from
   `influence.overlapRatio`. When a proposal once echoed the coach but the ratio
   is now 0, this reads "Echoes coach · 0%". This is the most likely target.
2. The **suggestion-adoption** path carries `currentOverlapRatio` /
   `peakOverlapRatio` (`App.tsx:3313`) but currently only feeds the **event
   ledger** (`suggestion_adoption_changed`), not a visible badge — grep confirms
   no UI render of `currentOverlapRatio`. If product wants the *card's* adoption
   decay surfaced, that is a larger add; **do not** build a new surface in this
   polish pass — scope it back to Nhyira.

**DECIDED (Nhyira 2026-07-24): fix the snapshot badge now** (option a); the
richer surface may be revisited later. Known and accepted trade-off: the
`InfluenceBadge` shows a **one-time snapshot** (`overlapRatio` at proposal
creation), not the *decay* the original item-6 wording implied. The true
current-vs-peak decay signal lives only on the suggestion-adoption trace and is
**not rendered anywhere**; surfacing it is a larger Checkpoint-6-sized add,
**deferred** (see AGENT-HANDOFF.md). This pass accepts the slight semantic
stretch — a proposal that echoes only a *tiny* fraction of phrases (rounds to
0%) will read "was AI-suggested" — in exchange for killing the demo-ugly
"· 0%". If that stretch looks wrong in review, note it and move on; do not
expand scope to fix it here.

**Scope for this pass: fix `InfluenceBadge`.**
- **Data gap to know:** `InfluenceTrace` (`assistance-contract.ts:55`) carries
  `overlapRatio` (current) but **not** `peakOverlapRatio`. So the badge cannot
  compare current-vs-peak. Use the signal it *does* have: the trace exists with
  `exactOverlapPhrases.length > 0` (it once echoed) but `overlapRatio` is 0 (or
  undefined-after-decay).
- **Rule (precise trigger):** the badge returns early unless
  `exactOverlapPhrases.length > 0`, and computes `pct = Math.round(overlapRatio
  * 100)`. The misleading state is **`pct === 0`** (`overlapRatio` in
  `[0, 0.005)`), which is what prints "· 0%". So: when `pct === 0` → render
  **`t("was AI-suggested")`** instead of the `Echoes coach · 0%` text; when
  `pct > 0` → keep `Echoes coach · {pct}%`; when `overlapRatio` is `undefined`
  (legacy pre-percentage trace) → keep current behavior ("Echoes coach", no
  percentage), unchanged.
- **i18n:** add `"was AI-suggested"` to `src/i18n/source.json` and a Chinese
  value to `src/i18n/zh.json` (e.g. `"曾由 AI 建议"` — confirm against the file's
  existing style). Other locales degrade to English by design. Keep `t()` on the
  literal only (checkpoint-1 discipline).
- **Do NOT** thread `peakOverlapRatio` onto `InfluenceTrace` in this pass — that
  couples two provenance concepts and is out of scope. If the phrase-exists +
  zero-ratio signal proves insufficient in review, stop and ask Nhyira rather
  than expanding the data model.
- **Tests:** cover the three branches of the badge (positive ratio → percentage;
  zero ratio with phrases → "was AI-suggested"; undefined ratio → unchanged).

---

## Out of scope for all three
The `App.tsx` decomposition (item 7), Checkpoint 6 6b/6c-compare surfaces, the
Stage 4 eval, and the 6c live QA. Product philosophy in AGENT-HANDOFF.md is
binding — if any item exposes a philosophical choice, recommend and ask Nhyira;
do not decide unilaterally.
