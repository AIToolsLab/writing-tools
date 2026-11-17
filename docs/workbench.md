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
  `suggestion_accepted` logs `acceptedChars` and `draftChars`, so the share of a
  rewrite that came from accepted text can be read off the logs. That should help
  whatever "information threshold" design follows.

Nothing here writes to the document.

## Context

The prompt contains the brief (if set), the paragraph before the passage, the
instruction and the passage, in that order. The stable parts go first so the
engine's cache can reuse them: anything after an edit point is recomputed. It does not contain the whole document: scoring
returns a distribution for every prompt token, and requests run on every pause
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

## Stable predictions (`suggestionCache.ts`)

The property: **typing any prefix of a prediction doesn't change that
prediction's suffix**. A keystroke only removes suggestions that no longer
match. With vLLM, re-querying couldn't give that, because the model saw a
different token boundary each time. The engine conditions on characters, so in
principle survivors keep their relative odds on a fresh query, but a fresh
answer can still rank a new word above them or miss one the search didn't
reach. The cache makes the property hold outright, and saves requests. So:

- Each request asks for up to 8 distinct units (`NUM_BRANCHES`), more than
  the 5 shown, so there are survivors to fall back on.
- Each request's branches are stored as a tree rooted at its draft. A later
  draft is answered from the stored trees first. Survivors keep their order:
  older trees first. A new request is made only when fewer than 5 survive, and
  its branches fill the slots below the survivors.
- Probabilities are shown only for a request made for exactly the current
  draft. For a survivor, the conditional probability of the remaining suffix
  isn't recoverable from what's stored.
- Changing the instruction, source passage, brief or words-per-suggestion
  clears the cache.

This would be the "API we wish we had", done client-side. A backend layer for it
isn't needed yet.

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
  because the request asks for 8 distinct units. A probability floor on what's
  shown would hide them.
- Shown probabilities are lower bounds (branches the server didn't follow are
  missing), and survivors from an earlier request show none. Their
  conditional probability could now be estimated from what's stored (the
  prototype's `narrow`), but isn't yet.
- A highlight's alternative can be `�` when the model's top choice is the
  first byte of a multi-byte character.
- Sentence splitting is a regex (`. ! ?` plus whitespace), so "e.g. this" splits
  in the wrong place. The writer sees and can edit the passage.
- There's no way to take the rewrite back into the document yet. `applyEdit` exists on
  Word, but whether it should be offered here, and how accepted text is
  attributed, is an open design question.
- The conversation view from the prototype (the writer writes both sides) isn't ported.
