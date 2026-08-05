# Open-PR merge, test, and deploy plan

Written 2026-08-04 against `main` @ `c16d6ba`. Covers the open non-dependabot PRs
except #457 (add-in UX redesign, draft, deliberately parked).

## The headline

**Nothing conflicts textually.** Every open branch merges clean into today's
`main`, and every pair of them merges clean with each other:

```
for b in <branches>; do git merge-tree --write-tree origin/main origin/$b; done
```

reports zero conflicts for all ten branches, and the full pairwise matrix is
clean too. The only shared files are `frontend/CLAUDE.md` (four PRs append to
different sections), `backend/CLAUDE.md`/`docker-compose.yml` (#574 and #594),
and `backend/src/app.ts` + `frontend/src/account/AccountPage.tsx` (#566 and
#594) — all disjoint hunks.

The collisions that matter are **semantic**, and there are four. They are the
reason for the staging below, not merge order for its own sake.

## Four things to fix, not just merge

### 1. Google Docs staging is untestable today — blocks the whole test plan

`frontend/vite.config.ts:57` compiles the backend origin into the gdocs bundle:

```ts
'process.env.GDOCS_BACKEND_URL': JSON.stringify(isDev ? '' : urlProd),
```

Every non-dev build therefore points at `app.thoughtful-ai.com`. But
`google-docs-addon/sidebar.html:200` offers a **staging** source, and the
add-in image is built once per commit on `main` and deployed to both hosts
(`build-addin-image.yml`; CD pins by SHA). So picking "staging" in the sidebar
loads the staging *bundle* and talks to the **prod backend** — prod auth, prod
consent records, prod study logs.

That makes it impossible to safely test #566 (consent), #585 (doc-read errors),
or #581 (serialization) on Docs without touching production data. #595 notes
this in passing and correctly leaves it out of scope; it needs its own small PR.

**Fix:** drop the compile-time constant and let `resolveServerUrl()` derive the
origin from the bundle's own script URL — the fallback it already has at
`frontend/src/api/index.ts:28`. The gdocs bundle is a synchronously-loaded IIFE
and `SERVER_URL` is computed at module top level, so `document.currentScript` is
populated. Keep `urlProd` as the last-resort fallback rather than `/api`.

This is ~5 lines and it is stage 0.

### 2. #585 ships the bug its own description names

The PR body flags it and the code confirms it. The new `requestSuggestion`
catch calls `updateErrorInfo(describeGenerationError(err))` directly
(`frontend/src/pages/draft/index.tsx`, new block), but `lastRequestRef` is only
assigned inside `getSuggestion` (`:319`). `retryLastRequest` (`:377`) re-runs
`lastRequestRef.current`. So on a non-auth `ScriptError` — `retryable: true`, so
the Retry button renders — Retry re-issues **the last request that succeeded**,
with its stale `docContext`. The writer gets a fresh-looking suggestion
generated from a ten-minute-old document. If there was no earlier request, Retry
silently does nothing.

Chat and Revise both re-enter from the top and are correct; draft is the odd one
out. Two options:

- **Minimal:** stash the mode in the catch and have Retry re-enter
  `requestSuggestion(mode)`. ~6 lines.
- **What the PR body floats:** drop retry from the read-error path entirely, on
  the grounds that a failed read shouldn't enter history at all.

I'd take the minimal fix now — it makes draft consistent with the other two
pages, and the "should errors be in history" question is a bigger design call
that shouldn't gate a fix for a live Google Docs failure.

### 3. #581 makes paragraph coordinates host-dependent

`getParagraphs()` is the coordinate system for `view` and insert-after. After
#581, Google Docs drops blank lines:

```ts
return text.split('\n').filter((line) => line.trim() !== '');
```

Word (`wordEditorAPI.ts:190`) returns every paragraph item including empty ones,
and the standalone editor (`editor/editor.tsx:159`) returns every root child.
So paragraph index *N* means a different thing on Docs than on the other two
hosts.

The filter is right *for Markdown* — blank lines are block separators there, not
content. But it should be a documented, host-uniform decision, not a side effect
of one host's serializer. Either normalize all three hosts to drop empties, or
keep them and have the gdocs serializer emit an explicit block index. Worth
raising on the PR; not worth blocking it, since Docs' current behaviour
(the entire document as a single paragraph, per #588) is strictly worse.

### 4. #581 and #587 point in different directions on text matching

#581 makes `getDocText()` return Markdown on Docs (`## Heading`, `- item`,
`1. step`). #587 makes needle-matching tolerant of *typography* — dashes,
quotes, spaces — but not of Markdown syntax. On Docs the model will read
`## Introduction` and the host document contains `Introduction`, so any
match-and-edit round-trip through Apps Script fails.

This is inert right now: gdocs `applyEdit` is unimplemented (#590), and
`selectPhrase` is still a TODO in `googleDocsEditorAPI.ts:333`. But it means
**#590 must be implemented against Markdown-serialized text**, and it
strengthens the case for #589 ("send hosts ranges, not needles") — a range is
immune to both the typography problem and the Markdown problem at once.

Neither PR should be held for this. Both should land, and #589 should be
re-read afterwards with #587's `textMatching.ts` in hand: that module is a
better starting point for #589 than what's on `main` today, because it puts all
the folding in one place instead of four.

## Per-PR verdicts

| PR | What it is | Verdict | Live test needed |
|---|---|---|---|
| **#574** PostHog off the request path | Backend infra. Telemetry `await flush()` was deciding response status; a 526 from the proxy 500'd healthy requests and failed a deploy. Non-vacuous test (restoring the await fails 3 of 4). | **Merge first.** 80 commits behind but only `backend/CLAUDE.md`/`README.md` moved under it. Deploy-stability fix that everything else's testing depends on. | No |
| **#595** Manifest template per environment | Replaces build-time regex surgery with one template + env table; emits all three manifests every build. Prod manifest is byte-identical to the old output. | **Merge second.** This is what makes Word beta testing possible at all. | Sideload `manifest-staging.xml` once |
| **#596** Design docs | Docs only, 2 files, no code. | **Merge any time.** Zero risk. | No |
| **#581** GDocs → Markdown | Fixes #588 (paragraph breaks lost). Real `Code.gs` under test via stubbed `DocumentApp`, which is the right call. Adds a Debug page at `lab` tier. | **Merge, after raising the paragraph-index question.** Needs `clasp push` — bundle and add-on deploy separately, so this one is not done when it's merged. | **Yes, Docs** |
| **#585** Doc-read error handling | Good error taxonomy in `api/errors.ts`; the Apps Script authorization-expiry case is the one writers actually hit. | **Fix the stale-retry bug, then merge.** | **Yes, Docs** (let a sidebar sit until the grant expires) |
| **#566** Consent PR 2 | The one you want. First-run gate, account page, cross-tab sync failing closed at `none`. Code quality is good — `broadcastConsentChange` resolving `localStorage` *inside* the try is exactly the right instinct for the Office iframe. | **Rebase, regenerate snapshots, then merge.** 149 commits behind; E2E is red on a demo-page screenshot that `main` has since regenerated (`535f970`). | **Yes, Word and Docs** — see checklist |
| **#587** My Words typography tolerance | Leniency ladder, exhausted tier by tier, index-mapped back to source so replacements use the writer's real characters. The anchored run-together tier and the `notable`/`not able` guard are both correct calls. | **Merge.** Highest-quality PR in the set. | **Yes, Word** (voice edits) |
| **#598** Draft the brief from the document | Candidates render beside fields, never in them; session-only, never serialized; accept path goes through the same `setField` as typing. | **Merge last of the feature PRs.** No blocker found; it's the one that most deserves a real read on the *product* question rather than the code. | Optional (Word or Docs) |
| **#594** Room-scoped OAuth PKCE | Draft PoC. This *is* the tool-launch rearchitecture — it replaces the launcher grant with rooms + Authorization Code/PKCE. | **Leave draft.** Decide the paradigm before merging any of it. Rebase after #566 (both touch `AccountPage.tsx` and `app.ts`). | Not yet |
| **#519** Google add-on ToS | One static HTML file. Inert. | **Merge when the store listing is being prepared.** | No |

Also open and stale, not covered above: #449, #446, #435 (MaryChen68, 2+ months,
no activity). Worth an explicit close-or-refresh decision rather than leaving
them to rot.

## Staged plan

### Stage 0 — Unblock the test path (no product change)

1. Merge **#574**. Then remove/retarget `POSTHOG_HOST` in the k8s deployment —
   the new default does nothing while that env var is set explicitly. The PR
   flags this and it's easy to miss.
2. Merge **#595**.
3. New small PR: **derive the gdocs backend origin at runtime** (finding 1).
4. Deploy `main` to staging. Sideload `dist/manifest-staging.xml` in Word; run
   `npm run validate:staging` first, since `office-addin-manifest validate`
   couldn't run in the sandbox that produced #595.

Exit criteria: staging reachable in Word ("Beta Thoughtful") **and** in Docs
via the sidebar picker, with the Docs sidebar demonstrably hitting the staging
backend — check `/api/ping` or a study-log write, not just that the UI loads.

### Stage 1 — Free merges

Merge **#596** now. Merge **#519** whenever the store listing is being prepared.
Neither interacts with anything.

### Stage 2 — Google Docs correctness chain

1. Merge **#581**, then `clasp push` the add-on. Verify on a live doc: headings
   arrive as `#`, lists as `-`/`N.`, and `beforeCursor + selectedText +
   afterCursor` still reconstructs the document exactly (the Debug page this PR
   adds is the fastest way to see it).
2. Fix the stale-retry bug in **#585**, then merge. Verify against a real
   expired grant: open the sidebar, leave it until authorization lapses, then
   click a Draft feature and confirm the notice names "close and reopen the
   sidebar" and offers **no** Retry.
3. Re-read #589 and #590 with #587's `textMatching.ts` in hand before writing
   any gdocs `applyEdit`.

Do these before #566, so that when consent testing on Docs goes sideways you
already know the document-read path is sound.

### Stage 3 — Consent (#566)

1. Rebase onto `main`, regenerate Playwright snapshots, confirm E2E green.
2. Verify `consentUpdatedAt` survives the whole round trip on a **fresh real
   user** — it's exposed via Better Auth `additionalFields`
   (`backend/src/auth.ts:76`) and the gate keys on
   `hasSetConsent: !!device.user?.consentUpdatedAt`. A user whose session omits
   the field is permanently gated.
3. Live-test on staging, both hosts. This is the highest-blast-radius PR in the
   set: it is a **required** first-run gate for every authenticated user, so a
   failure here locks everyone out of the tool, not just the consent screen.
4. Merge, deploy to staging, soak, then prod.

Then rebase #594 on top.

### Stage 4 — My Words (#587)

Merge, then live-test voice editing in Word specifically: Word's autocorrect is
the source of the en-dash and curly-quote mismatches the PR exists to fix, so
the bug is only reproducible there. Confirm the notice strip retracts on a
landed edit (invariant 6) rather than persisting across turns.

### Stage 5 — Brief proposals (#598)

Merge and deploy. Then watch `brief_proposal_resolved` for the measurement the
PR was built around: candidates almost always accepted unedited would mean the
tool is writing the brief rather than co-creating it.

## Live-test checklists

**Word (staging manifest):**

- Consent gate appears once on first run, and not again after Continue (#566)
- Account & privacy opens in the external browser; the sign-in-again notice is
  accurate on this surface (#566)
- Consent lowered in the account tab silences the app tab's logging (#566) —
  the task-pane iframe is exactly where `localStorage` may be partitioned, so
  confirm the fail-closed path, not just the happy path
- Voice edit whose target contains an autocorrected en dash or curly quote now
  lands (#587)
- `move` re-inserts the characters it removed, not the model's spelling (#587)

**Google Docs (sidebar → staging, after stage 0):**

- Sidebar talks to the staging backend, not prod
- Headings/lists arrive as Markdown; concatenation invariant holds (#581)
- Paragraph count matches authored blocks (#588 fixed)
- Expired grant → correct notice, no Retry button (#585)
- Consent gate and cross-tab sync behave as in Word (#566)

## Decisions I need from you

1. **#585 retry:** minimal fix (stash the mode) or drop retry from the
   read-error path? I'd do the minimal fix now.
2. **Paragraph coordinates (finding 3):** normalize all three hosts to drop
   empty paragraphs, or keep them and index blocks explicitly?
3. **#594:** is room-scoped OAuth the direction? Until that's settled, #594 sits
   and the launcher grant stays. Nothing else in the open set depends on the
   answer, so this doesn't block stages 0–5.
4. **#449 / #446 / #435:** close, or assign someone to refresh them?
