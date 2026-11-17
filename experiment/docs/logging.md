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
files or a whole folder. Files are read locally and never uploaded. It applies the notes
below (dedupe, ordering, `seq` gaps) and shows:

- **One row per participant** with flags for: task or post-task survey not submitted, lost
  events, reloads, more than one git commit, condition/scenario mismatches, AI events in
  the wrong condition, and a missing or mismatched `email_feedback` keystroke log. The
  table also shows the "technical difficulties" answer.
- **A colleague-opener check.** It compares each task page load's first colleague message
  across all loaded files, so a load showing another scenario's opener (e.g. the
  pre-`700c859` race that showed the default scenario) gets flagged.
- **Per-participant detail:** the chat transcript (split at reloads), the submitted email,
  email length over time with chat/AI markers, a slider through every `documentUpdate`
  snapshot, AI suggestions, both surveys, a replay of the `email_feedback` keystroke log,
  and the raw events.

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
