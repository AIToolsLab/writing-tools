# Workbench (lab page)

Takes a sentence, paragraph or selection off to the side and works on it with
token-level help from an open-weights model. It's a port of
[AIToolsLab/writing-prototypes](https://github.com/AIToolsLab/writing-prototypes)
(`docs/`, the tokens engine) into the sidebar. You reach it from the Labs (···) menu.

Code: `frontend/src/pages/workbench/` and `frontend/src/api/writingEngine.ts`.

## Modes

- **Highlights**: the passage is scored as the model's response to "apply this
  instruction to this passage". Tokens where the model's top choice differs are
  marked, ranked by how much more likely that choice was. They point at places;
  they never replace text.
- **Predict**: the writer writes their own version and gets next-word predictions
  (1–3 words). The value judgment is that the AI's words can't get ahead of the
  writer's input. Blind acceptance is still possible.
  `suggestion_accepted` logs `acceptedChars`, `replacedChars` and `draftChars`,
  so the share of a rewrite that came from accepted text can be read off the logs. That should help
  whatever "information threshold" design follows.

Nothing here writes to the document.

## Context

The prompt contains the brief (if set), the paragraph before the passage, the
instruction and the passage, in that order. The stable parts go first so the
engine's cache can reuse them: anything after an edit point is recomputed. It does not contain the whole document: scoring
returns a distribution for every prompt token, and requests run on every keystroke or pause
in typing. A targeted summary of the rest of the document (concepts, terms,
names), written by the big model, is a possible next step.

## Server

The page calls the **writing engine** at `llm.thoughtful-ai.com` directly from
the browser: no token, CORS open. It's a small llama.cpp-based server from
writing-prototypes (`engine/`; its `MIGRATING.md` explains the move from vLLM).
These requests skip the backend's auth, consent stripping and `llm_usage`
metering. The page footer says where text goes. Override the server with
`VITE_ENGINE_URL`.

What the page uses:

- `POST /v1/template` renders the chat prefix (cached client-side).
- `POST /v1/score` gives, per token of the passage, its logprob and the model's
  top choice there. That's all highlights need.
- `POST /v1/continuations` gives continuations of the draft with the model's
  probability of each, **conditioned on the typed characters** (summed over
  every tokenization of them). The client groups them into words. There's no
  token healing in the client any more; the server does the equivalent.

Each tab sends a random `session` id, so writers don't evict each other's cache.
A newer continuations request from the same session supersedes older ones,
which come back 409; the client treats that as an abort. POSTs go as
`text/plain` so there's no CORS preflight per keystroke.

Response times are logged (`highlights_scored`, `predictions_fetched`): `ms` is
the wall time of the whole operation, `serverMs` the engine's own time. Log
schema 8 marks the switch; times before it were against vLLM.

Measured on 2026-11-11 (Qwen3.8-27B, about 20-token passage, from a browser in
the cloud): highlights about 75 ms on the server and 470 ms end to end on first
use (model list and template render included); predictions about 85 ms on the
server, 300–460 ms end to end. Most of the gap is network.

The engine and the old vLLM server can't share the GPU, so only one runs at a
time. When the engine is down, the page shows "Couldn't reach the model
server".

## Predictions

Suggestions are **words, never punctuation**, as on phone keyboards
(`words.ts`). A unit of n words ends early at punctuation, and a continuation
that starts with punctuation offers nothing. Punctuation between letters is
part of a word ("U.S.", "e.g.", "1,000", "and/or"). `*`, `<`, `>` and `` ` ``
end words, so Markdown and HTML fragments aren't offered. The same pattern is
the server's `stop` regex, so the server's count of distinct units (`units`)
matches what the page groups and shows.

- **One request per keystroke**, with no debounce. The server drops a request
  once a newer one arrives from the same tab (409, treated as an abort). While
  a request is out, the page narrows the last answer to what's still possible
  after the characters typed since (`narrow`), so slots update right away.
  Highlights still wait 150 ms for a pause, because the server doesn't drop
  superseded scoring requests.
- **5 units per request** (`units: 5`), the number shown. Asking for more used
  to give the suggestion cache survivors; with the cache gone, extra units only
  cost search time. The search is capped at 150 ms (`time_ms`).
- A completion of the word being typed shows the **whole word**, with the typed
  part grayed ("pop" + "ular").
- **Corrections** (`corrections: 1`): the engine also follows paths that leave
  the typed text within its last word, if they're more likely than everything
  that keeps to it. The page shows up to 2, first, with a wavy underline and
  how many times as likely they are, but only if: the typed word has 3 or
  more characters; the correction keeps its first letter; it's within 2 edits
  (1 for words of 4 characters or fewer; case is free, so iphone → iPhone); and
  it's within 100× of the best correction. The server only reconsiders the
  word being typed, so once a space follows it, the page keeps the corrections
  it had (`Predictor`). The thresholds are the prototype's.

The suggestion cache that held predictions still while they were typed into was
removed. Add it back (git history: `suggestionCache.ts`) if suggestions shifting
under the writer turns out to be a problem. In principle the engine keeps the
survivors' relative odds, because it conditions on characters. A fresh answer
can still rank a new word above them.

## Character offsets

Highlights are placed by adding up each scored token's `text` length. The
server merges tokens that split a character (𝔽, 🦩), so every item is valid
text and the lengths add up. The page warns if they don't.

The engine's tokenizer doesn't Unicode-normalize (vLLM's did), so offsets hold
for decomposed text too. Passages are still NFC-normalized when pulled: a
decomposed accent (`e` + U+0301) is its own rare token, and the model scores it
as wildly unlikely.

## Known gaps

- Mid-word, the slots below a near-certain completion fill with near-misses
  at <1% ("ularity", "ulaire", "olare" beside 100% "ular" after "a pop"),
  because the request asks for 5 distinct units. A probability floor on what's
  shown would hide them.
- Shown probabilities are lower bounds: branches the server didn't follow are
  missing.
- A correction mid-word often isn't finished within the 150 ms cap (for
  "populr", "ar" is found but not confirmed as the word's end), so it's
  dropped. "Many peple" → "people" works. Corrections the model wants to
  make into a different word ("plce" → "spot") are dropped as not a respelling.
- Slots are narrow in the sidebar, so whole-word completions and corrections
  truncate sooner ("peo…").
- A highlight's alternative can be `�` when the model's top choice is the
  first byte of a multi-byte character.
- Sentence splitting is a regex (`. ! ?` plus whitespace), so "e.g. this" splits
  in the wrong place. The writer sees and can edit the passage.
- There's no way to take the rewrite back into the document yet. `applyEdit` exists on
  Word, but whether it should be offered here, and how accepted text is
  attributed, is an open design question.
- The conversation view from the prototype (the writer writes both sides) isn't ported.
