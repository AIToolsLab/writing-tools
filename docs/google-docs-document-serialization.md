# Google Docs: how the document reaches the model

The Google Docs add-on serializes the document to **Markdown** before it leaves
Apps Script. This note records what survives that trip, what is deliberately
flattened, what is dropped, and how to check any of it.

The code is `serializeBody` in `google-docs-addon/Code.gs`; the tests are
`frontend/src/api/__tests__/googleDocsMarkdown.test.ts`.

## Why Markdown

The only consumer of the document text is an LLM prompt, and Markdown is the
notation those models read most fluently. The previous serialization was bare
text, which lost more than it looked like:

- A heading arrived as an ordinary sentence. Nothing marked it as a heading, so
  a document's structure was invisible to the model.
- A bulleted list arrived as prose. Docs renders bullets and numbers *from list
  formatting*, so the glyphs are not characters — `getText()` on a list item
  returns only the words, never `•` or `1.`, and nesting depth is likewise
  invisible.
- Paragraphs ran together with no separator at all. `DocumentApp` text carries
  no trailing newline (the paragraph boundary *is* the newline, and only
  `Body.getText()` inserts it), and the old extractor concatenated paragraph
  text directly. Two paragraphs reached the model as one run-on sentence, and
  `getParagraphs()` on the frontend — which splits the result on `\n` — returned
  the entire document as a single paragraph.

## What survives

| In Docs | In the serialized text |
|---|---|
| Heading 1–6 | `#` … `######` |
| Title | `#` |
| Subtitle | plain paragraph |
| Body text | plain paragraph |
| Bullet (round, hollow, square) | `- ` |
| Numbered / lettered / roman | `1. `, numbered sequentially |
| List nesting | four spaces per level |
| Paragraph break | blank line |
| Empty paragraph | nothing (it is spacing, not content) |
| Table | **dropped** |
| Image | **dropped** |
| Comments | **not available** — see below |

## Deliberate flattening

Where Docs is richer than Markdown we map to the nearest Markdown form rather
than invent notation, because a private convention is one more thing for the
model to misread.

- **Title and Heading 1 both become `#`.** A document using both loses that
  distinction. Markdown's top level *is* the document title, and the overlap is
  rare enough not to justify a custom marker.
- **Subtitle becomes a plain paragraph.** It is not an outline level in Docs —
  it doesn't appear in the document outline — so giving it a `#` would claim a
  section boundary that isn't there.
- **Hollow and square bullets become `-`,** like round ones. Markdown's `*`,
  `-`, and `+` are interchangeable renderers' choices, not distinct meanings.
- **All ordered glyphs become `N.`.** Latin and roman numbering are a display
  choice in Docs; the ordinal is the meaning.

Ordered items are numbered sequentially rather than all emitted as `1.` (which
Markdown also accepts). The numbers are what make an item referenceable — a
writer asking about "the third step" and a model answering about it need the
same label.

## Cursor and selection positioning

`getDocContext()` returns `beforeCursor` / `selectedText` / `afterCursor`, and
those three **always concatenate back to exactly the serialized document**.
Callers rely on it (`getDocText` is that concatenation), and the tests assert it
on every positioning case.

Getting there required dropping the old approach. It searched the flattened text
for the selected string, which had two failure modes: a phrase occurring twice
resolved to the first occurrence, and once Markdown prefixes existed the search
could not succeed at all — the selected text of a heading does not contain the
`## ` in front of it.

Positions are now derived structurally. `serializeBody` returns, alongside the
Markdown, an index recording where each top-level child's own text landed.
`topLevelChildIndex` walks up from whatever element the cursor points at
(usually a Text run inside a paragraph) to the body child containing it, and the
offset is looked up rather than searched for.

A wholly-selected element starts at its Markdown prefix rather than after it, so
selecting a heading yields `## Heading` — the prefix is part of that span of the
document, and including it is what keeps the concatenation exact.

If a position can't be placed (an element outside the body, such as a header or
footnote), the whole document is returned as `beforeCursor` rather than
throwing. A serialization error must not take the sidebar down.

## Comments are not available

`DocumentApp` has no comments API at all — not content, not authors, not
anchors. Neither does the Docs REST API v1.

Comments live in the **Drive API** (`comments.list` on the file), which returns
`content`/`htmlContent`, `replies`, `author`, `resolved`, and
`quotedFileContent.value` — the text the comment is anchored to. The `anchor`
field is an opaque `kix`-style region string with no supported mapping to a
document offset, so locating a comment in practice means searching for its
quoted text, much as `selectPhrase()` already does.

The blocker is scope. `appsscript.json` requests only
`documents.currentonly`, `script.container.ui`, and `userinfo.email`, and
`Code.gs` is annotated `@OnlyCurrentDoc`. Reading comments means adding a Drive
scope and enabling the Advanced Drive Service — a visible expansion of what
users are asked to authorize. Tracked separately; not part of this
serialization.

## How to check it

Three layers, cheapest first.

**1. Unit tests** — `npm test` in `frontend/`. These run the real `Code.gs`:
`frontend/src/api/__tests__/helpers/appsScript.ts` reads the file and evaluates
it with a stubbed `DocumentApp`, so the tests cover the file that actually ships
rather than a copy that can drift from it. Fakes implement only the element
methods `Code.gs` calls, so anything the serializer starts calling has to be
added there.

This is where mapping logic belongs. Iterating a glyph table through `clasp
push` + sidebar reload costs minutes per attempt; here it costs milliseconds.

**2. The Debug page** — a `lab`-tier page (`frontend/src/pages/debug/`),
reachable from the Labs (···) menu on every surface. It shows the document
exactly as the model receives it, with the cursor position marked inline, plus
the paragraph list and character count. This is the only way to verify the real
round-trip — real document, real Apps Script, real bridge — and it works on Word
and the standalone editor too, which makes it the quickest way to compare how
the two editors serialize the same document.

It is deliberately *not* behind a feature flag. Flags are set from the URL, and
neither the Word task pane nor the Google Docs sidebar has an addressable URL
(see `frontend/src/pages/flags.ts`), so gating it would leave it reachable only
where it is least needed.

**3. The devtools console** — zero code, for a one-off poke. Open devtools on
the sidebar, switch the frame selector to the sandboxed userHtmlFrame, then:

```js
await window.GoogleAppsScript.getDocContext();
```

Useful when something looks wrong *below* the bridge and you want to see the
raw Apps Script response. Not a substitute for either layer above, since every
call is a full round-trip and nothing is asserted.

## Known gaps

- **Tables and images are dropped.** They were dropped before Markdown too, so
  this is not a regression, but a Markdown serializer that silently omits a
  table is a reasonable thing to fix — Markdown has table syntax.
- **Comments** — see above.
- **Text formatting** (bold, italic, links) is not carried. Docs stores it as
  attributes over text ranges rather than as characters, so mapping it means
  walking attribute runs within each paragraph.
