# Reviewing guidelines

What to check in a PR, beyond "does it work". These cover the areas where a
mistake is cheap to make and expensive to discover later. Each item is a
question a reviewer can answer from the diff. Deliberately short: add an
item when a real mistake shows it was needed, not in anticipation.

## Consent and stored data

We promise each writer what is stored at their consent level (the copy is in
`frontend/src/consent.ts` `CONSENT_LEVEL_LABELS` and
`frontend/public/privacypolicy.html`). The code can only keep that promise
if every stored field is classified correctly, and only review can check
that free text didn't end up in the wrong place.

- **Is every new log field in the right bucket?** Event payloads are split
  into `usage` / `ai_output` / `document` (see `frontend/src/api/logging.ts`).
  `usage` is for counts, timings, modes and ids — never text the writer or
  the model wrote, even a short one (a title, a selection, a field label the
  writer typed). Types stop an object from going in `usage`; they don't stop
  a string. When unsure, use the higher bucket.
- **Could AI output carry the writer's text?** That's allowed in `ai_output`
  (the consent copy says so), but anything that is *only* the writer's text
  belongs in `document`.
- **Does new stored data outside the logs respect consent and erasure?** New
  tables, files or third-party calls (PostHog etc.) that hold user data
  need to be covered by "delete my data" (`backend/src/erasure.ts`) or have
  a stated reason why not (as `llm_usage` does).
- **Does the change make any consent copy untrue?** If so, update the copy
  and the privacy policy in the same PR.

## The thoughtfulness value

Central concept: the LLM helps thinking and reflection instead of replacing
writing. The commitments are in `docs/design/interface-concepts.md` ("Shared
covenant").

- **Does any path put model-written prose into the writer's document?**
  Edits proposed by the model go through the word-bank check
  (`frontend/src/pages/chat/chatTools.ts`) and the writer's approval. A new
  path that inserts or rewrites text needs the same, or a stated reason.
- **Is model-produced prose framed as material to react to,** not as an
  answer to accept? Questions, observations and quotes of the writer's own
  text are preferred over finished sentences.
- **Does the AI grade?** Scores, checkmarks and "done" verdicts belong to the
  writer.
- **Does it interrupt?** Proactive output should wait for a pause or a
  request.
- **Do prompts frame the writer as the author,** not as a supervisor of an
  output machine? (The brief's fields are facts about the document, never
  instructions to the model — see `frontend/CLAUDE.md`.)

## Cross-platform compatibility

The add-in runs in Word, Google Docs, and the standalone editor, from one
frontend.

- **Does document access go through `EditorAPI`?** Not Office.js, Apps
  Script or Lexical directly from a page. If it adds an `EditorAPI` method,
  are all implementations updated (Word, Google Docs, standalone, and the
  default in `contexts/editorContext.tsx`)?
- **Does it survive Apps Script version drift?** The Google Docs bundle and
  the Apps Script add-on deploy separately, so new bundle code must degrade
  when the installed `Code.gs` predates it (the document-settings fallback
  is the example).
- **Does it fit the ~300px Google Docs sidebar?** It has no splitter. Core
  tabs are capped at three for this reason (`src/pages/registry.tsx`).
- **Does anything new get written into users' files** (document settings or
  properties)? Those can't be migrated later, so key names and value formats
  need to be ones we can live with indefinitely, and the reader must
  tolerate unknown fields.
- **Was it tried on more than one surface?** If not, say which ones in the
  PR description.

## Requests and their failures

Most error-handling bugs here have come from a request that was only
written for its happy path. Walk each request a change adds or touches
through its states — idle, in flight (including the document read before
generation), succeeded, empty, failed, cancelled — and check:

- **Is the document read inside the request's `try`?** It's a request of its
  own (an Apps Script round-trip on Google Docs) and fails on its own terms.
  Outside the `try`, a failure skips the `finally` and leaves the page stuck
  "loading" with nothing on screen.
- **Does Retry start the ask over?** It should re-read the document and
  rebuild the request, not replay a captured one with a stale snapshot.
- **Can starting this request cancel one already in flight, and what happens
  to that one's UI?** If an aborted request just returns, whatever it was
  showing is stranded.
- **Is "couldn't" kept apart from "nothing"?** A failed read is not an empty
  document, and a failed generation is not an empty result.
- **Is the failure logged?** If it isn't, the next report of it can't be
  diagnosed.

See "Requests and their lifecycle" in `frontend/CLAUDE.md`.
