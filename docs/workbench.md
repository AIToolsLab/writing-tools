# Workbench (lab page)

Takes a sentence, paragraph or selection off to the side and works on it with
token-level help from an open-weights model. It's a port of
[AIToolsLab/writing-prototypes](https://github.com/AIToolsLab/writing-prototypes)
(`docs/`, the tokens engine) into the sidebar. You reach it from the Labs (···) menu.

Code: `frontend/src/pages/workbench/` and `frontend/src/api/vllm.ts`.

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
instruction and the passage, in that order. The stable parts go first so vLLM's
prefix cache can reuse them. It does not contain the whole document: scoring
returns a distribution for every prompt token, and requests run on every pause
in typing. A targeted summary of the rest of the document (concepts, terms,
names), written by the big model, is a possible next step.

## Server

The page calls `vllm.thoughtful-ai.com` **directly from the browser**: no
token, CORS open. That means these requests skip the backend's auth, consent
stripping and `llm_usage` metering. The page footer says where text goes.
Response times are logged (`highlights_scored`, `predictions_fetched`: `ms` is
the wall time of the whole operation). If they get untenable, that's when to
think about limits or a proxy. Override the server with `VITE_VLLM_URL`.

Measured on 2026-11-04 (Qwen3.8-27B, about 30-token passage): first highlights
1.3 s cold (model list plus prefix render), then about 180 ms per completion.
Predictions took 0.7–1.1 s for each draft, keeping 8 branches.

## Stable predictions (`suggestionCache.ts`)

The property: **typing any prefix of a prediction doesn't change that
prediction's suffix**. A keystroke only removes suggestions that no longer
match. Re-querying on every keystroke can't give that, because the model sees a
different token boundary each time and predicts something else (see
writing-prototypes `experiments/token-healing/README.md`). So:

- Each request keeps up to 8 branches (`NUM_BRANCHES`), more than the 5 shown.
  The server handles 8 before slowing sharply.
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

Highlights are placed by adding up each token's `decoded_token` length.
Checked against the server:

- **Byte-split characters are fine.** For a character split across tokens
  (𝔽, 龘, 🦩), vLLM decodes the leading partial tokens as `''` and puts the
  whole character on the last one, so lengths add up. The engine skips the
  empty tokens; the prototype emitted zero-width ranges for them.
- **Unicode normalization is not.** Qwen's tokenizer NFC-normalizes, so a
  decomposed `e` + U+0301 (2 code units) comes back as `é` (1). Passages are
  NFC-normalized when pulled. A passage typed into the textarea in NFD would
  still misalign, and the page warns when that happens.

## Known gaps

- Shown probabilities are of the whole path from the last token boundary,
  *including* the typed text (inherited from the prototype). So after some
  drafts they all read "<1%". After "Used", for example, every branch carries
  P("Used"). The ranking holds; the absolute numbers aren't comparable across
  drafts.
- Mid-word, the healed spine can wander into near-misses ("icaly,", "icall,"
  after "Used eth"). With 8 branches kept, these can fill the shown slots
  at <1% beside a 77% real word. A probability floor on what's shown would
  hide them.
- Sentence splitting is a regex (`. ! ?` plus whitespace), so "e.g. this" splits
  in the wrong place. The writer sees and can edit the passage.
- There's no way to take the rewrite back into the document yet. `applyEdit` exists on
  Word, but whether it should be offered here, and how accepted text is
  attributed, is an open design question.
- The conversation view from the prototype (the writer writes both sides) isn't ported.
