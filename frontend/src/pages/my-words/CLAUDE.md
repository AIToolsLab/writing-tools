# My Words

A map of this page, for finding the right file before reading any of them. Each
module's own header comment is the real documentation — this is only an index to
them.

**The concept:** the AI may edit the writer's document but never *originate*
words. Everything it places is lifted from the writer's own corpus. See
`docs/my-words-interaction-design.md` for the why.

## Two turn-loops, one edit path

The page has three tabs (`index.tsx`). Walkthrough and Propose share a
text-model loop; Voice runs its own, because the realtime model drives turns
itself. Only the *turn-taking* differs — an edit is an edit in both.

```
text tabs                            voice tab
─────────                            ─────────
liveResponder.ts   (model, 1 step)   voice/realtime.ts   (OpenAI Realtime)
  → strategies/{walkthrough,propose} → voice/session.ts  (tools + invariants)
  → interaction/shared.ts  ───┐  ┌───┘
                              ↓  ↓
                    interaction/ops.ts     lowerOp: EditOp → ParagraphSplice[]
                    interaction/editor.ts  reveal beat, veto, splice → host
                              ↓
                    EditorAPI (Word / Google Docs / Lexical / MockEditor)
```

- `interaction/types.ts` — `EditOp`, `Responder`, `AssistantMove`. Start here.
- `interaction/ops.ts` — **every** op lowers to a `ParagraphSplice`. Pure, so
  preview and apply can't drift. Paragraphs are the coordinate system `view`
  numbers and inserts index into.
- `interaction/editor.ts` — reveal-then-apply, and the adapter for hosts without
  a native `applySplice`.
- `voice/session.ts` — the six tools' dispatcher, and the numbered **control
  invariants**. Change one and `__tests__/voiceControl.test.ts` should be how you
  find out.
- `voice/tools.ts` — tool schemas; the descriptions are the model's only guidance
  on paragraph targeting.
- `corpus.ts` — the word-bank rule. The riskiest file here, unit-tested directly.

## Where text gets matched against the document

Four places, and they should agree. A phrase the model utters has to be found in
text some host stores, and they disagree constantly over hyphens, curly quotes,
and spacing — see `@/utilities/textMatching`, which owns the fold ladder all of
these use or should use. Its last rung drops separators entirely ("email" finds
"e-mail") and is the only one anchored to word boundaries; loosening it further,
or dropping the anchor, is how a match starts landing on text no reader would
call the same phrase.

| What | Where |
| --- | --- |
| Locating an op's target span | `interaction/ops.ts` → `findSpan` |
| Word-bank validation (tokenizer) | `corpus.ts` → `tokenize` |
| `highlight` / reveal, standalone editor | `@/editor/editor.tsx` → `selectPhrase` |
| `highlight` / reveal, Word | `@/api/wordEditorAPI.ts` → `selectPhrase` |

Google Docs (`@/api/googleDocsEditorAPI.ts`) delegates to Apps Script and is not
yet folded; `demo/mockEditor.ts` always succeeds, so a miss there is invisible in
tests.

## Tests

`__tests__/` splits by class, and the split is deliberate:

- `ops.test.ts`, `corpus.test.ts`, `spliceAdapter.test.ts` — pure functions.
- `voiceControl.test.ts` — *sequencing*: a whole model turn through the real
  session, against `MockEditor` and a fake transport.

`demo/` is a standalone harness (`DemoApp.tsx`, scripted responder, mock editor)
for driving the interaction without a model or an Office host.
