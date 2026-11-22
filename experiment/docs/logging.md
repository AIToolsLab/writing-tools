# Study event logging

Client: `lib/logging.ts`. Server: `app/api/log/route.ts`. Output: `logs/<username>.jsonl`
(mounted at `/opt/thoughtful/experiment-logs` in production).

## How events get to disk

1. `log(payload)` stamps the event (`timestamp`, `sessionId`, `seq`, `wave`, `gitCommit`)
   and queues it. It never blocks or throws.
2. About once per second, the queue is uploaded as a JSON array, one batch at a time.
   Events leave the queue only after a 2xx. On a 5xx or network error it retries with
   backoff (up to 10s), indefinitely while the page is open. A 4xx drops the batch, because
   retrying would fail the same way and block the queue.
3. When the page is hidden or unloaded, the queue is copied to `localStorage`. On
   `pagehide` it also tries a `keepalive` upload of whatever fits in 60KB. The next page
   load uploads anything left in `localStorage`.
4. `redirect(url)` / `logThenRedirect(payload, url)` wait for the queue to drain before
   navigating, retrying indefinitely: **participants can't advance while logging is
   failing.** `LogStatusBanner` (mounted once on the study page) explains the wait.
   Use these for all study page transitions. Batches dropped on a 4xx don't block,
   because waiting can't recover them; they show up as `seq` gaps.
5. `beforeunload` prompts if events are still queued, except during `redirect`.

The server writes every entry with a valid username and skips (rather than rejects)
invalid ones.

## Quick look: `scripts/log-viewer.html`

Open `scripts/log-viewer.html` in a browser (straight from disk, no server) and drop in log
files or a whole folder. Files are read locally and never uploaded, except that rubric
coding (below) sends one participant's text to the LLM endpoint you configure, when you
click for it. It applies the notes below (dedupe, ordering, `seq` gaps) and shows:

- **One row per participant** with flags for: task or post-task survey not submitted, lost
  events, reloads, more than one git commit, condition/scenario mismatches, AI events in
  the wrong condition, a missing or mismatched `email_feedback` keystroke log, page loads
  after the final page (restored tabs), and screen problems. The "technical difficulties"
  answer is only flagged when it isn't a short "no"/"none"/"no issues detected"-style
  answer.
- **Screen check.** From the window size logged at "Started Study", it estimates the task
  page's email column (window width minus the fixed sidebars: 1000px with the AI panel,
  540px without; see `emailColumnWidth` in `log-viewer/analysis.js`). Under 250px is
  flagged red, under 450px yellow; short windows, zoom and mobile user agents too. Window
  size is logged once, so later resizes aren't seen. Note that the study's own minimum
  (`MIN_SCREEN_WIDTH` = 600) lets through windows where the AI conditions leave no room
  for the email.
- **A colleague-opener check.** It compares each task page load's first colleague message
  across all loaded files, so a load showing another scenario's opener (e.g. the
  pre-`700c859` race that showed the default scenario) gets flagged.
- **Where the email's words came from.** Every run of at least 4 words (adjustable) that
  the email shares with an AI suggestion, a colleague message, or the participant's own
  chat message is colored by source, in pieces, so an email stitched from several
  suggestions still matches. A run is credited to a source only if the source showed it
  *before* it first appeared in any `documentUpdate` snapshot; otherwise it's an "echo"
  (the AI sees the draft and often repeats it). This measures verbatim reuse only; an
  idea taken from a suggestion and reworded doesn't count.
- **Per-participant detail:** the chat transcript (split at reloads), the submitted email,
  email length over time with chat/AI markers, a slider through every `documentUpdate`
  snapshot, AI suggestions (with how many words each contributed), both surveys, a replay
  of the `email_feedback` keystroke log, rubric coding, and the raw events.
- **Summary across participants** (collapsed at first): behavior, overlap, specific
  recall, TLX and AI ratings, and rubric levels, grouped by condition or by scenario. In
  the scenario view, cells at least 1 sd from the overall mean are shaded, as a screening
  aid. Also: a chance baseline for overlap (no-AI emails vs. AI text others saw), the
  specific-recall answers per scenario, and every free-text answer to a chosen question
  side by side, with rubric evidence highlighted.

### Specific recall scoring

Some specific-recall concerns describe things that were *not* in the scenario, so an
engaged participant shouldn't remember considering them. These are listed in the
codebook's `reverseCodedRecall`. A "yes" on one is a false alarm; a "yes" on any other
concern is a hit. The default list is a guess from the wording; confirm it.

### Rubric coding

The codebook (`log-viewer/default-codebook.js` is the starting point) holds rubric
`items` (optionally limited to `scenarios`), the `levels`, coder `instructions`, and
`reverseCodedRecall`. Edit it in the page, or save it as JSON, edit it, and drop it back
on the page. Your working copy lives in the browser's localStorage.

"Code with LLM" sends one participant's chat, email and free-text survey answers (with
the question texts and the scenario background) to an OpenAI-compatible
`/chat/completions` endpoint. The model returns a level per item with exact quotes, the
considerations no item covers, and feedback on the rubric. The viewer highlights each
quote in the participant's text (and warns when a quote isn't there verbatim), so you can
check the coding and see what was left uncited. Results are stored per codebook hash, so
editing the rubric marks earlier results stale. Export/import them as JSON to share.

The default endpoint is OpenAI's API (`https://api.openai.com/v1`). Paste your own API key into the viewer's settings. You can also point the viewer at another OpenAI-compatible server (e.g. `https://openrouter.ai/api/v1`) with your own key. Check that your consent language covers the provider you send participant text to.

The viewer can't import the survey definitions, so `log-viewer/study-materials.js` is
generated from `components/survey/surveyData.tsx` and `lib/scenarios.json` by
`__tests__/scripts/studyMaterials.test.ts`, which fails when it's out of date. Regenerate
with `npx vitest run __tests__/scripts/studyMaterials.test.ts -u`. It reflects the
current survey, so older logs may have answers the materials don't describe.

It knows the page list, condition codes and the `email_feedback` /
`technical_difficulties` question ids. Update the constants at the top of its script if
those change.

For analysis rather than checking, see `../scripts/extract_experiment_data.py`. Note that
it skips participants without `taskComplete` and doesn't deduplicate.

## Analysis notes

- **Deduplicate on `(sessionId, seq)`.** Duplicates are expected: a batch is retried
  if the server's reply was lost, and a `pagehide` upload may be resent from
  `localStorage` on the next load.
- **Order by `timestamp`, not file order.** Recovered events arrive late.
- **Gaps in `seq` within a session mean lost events.** Remaining loss cases: the
  browser crashes while the tab is visible (loses up to about 1s of events), or the
  participant closes the tab while offline and never comes back to the site.
- `sessionId` is new on every page load, so a reload of the task page appears as a new
  session with the same username. Survey answers survive a reload (saved in
  `localStorage` per username and page, cleared on submit). The task page's draft and
  chat don't survive, so it shows a "Leave site?" prompt before an unload it didn't start.
- `documentUpdate` events hold full-document snapshots on every keystroke. They are
  highly redundant, so compress log files at rest (e.g. `zstd --long`).
- `surveyInputUpdate` events do the same for survey text questions marked
  `logChanges` (currently the post-task email feedback micro-task): `questionId`,
  the full `value`, and its `length` on every change. The final answers are still
  in `surveyComplete:*`.
- Both `surveyComplete:*` events have `extra_data: { scenarioId, condition, answers }`,
  with `answers` keyed by question id. Some post-task keys (`comprehension_*`) mean a
  different question in each scenario, so `scenarioId` is needed to interpret them.
  It is the scenario actually used (an unknown `?scenario=` falls back to the default
  scenario). Logs from before this change have the answers directly in `extra_data`.
- Question ids are unique within each survey (checked by
  `__tests__/components/surveyData.test.ts`), and "please specify" text is stored
  as `<id>_other`.
