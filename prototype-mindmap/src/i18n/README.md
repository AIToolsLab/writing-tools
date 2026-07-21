# Interface dictionaries

- `source.json` — the canonical list of English interface strings. **The one file
  you edit by hand.**
- `<code>.json` — one generated dictionary per language, mapping each English
  source string to its translation.


`../ui-strings.ts` looks copy up here for whichever language the page is being
shown in. Every lookup is synchronous and offline, so switching the write or the
view language re-skins the page **instantly and for free** — interface copy never
reaches the translation engine.

A string with no entry simply renders in English. A partial or missing dictionary
degrades in coverage, never in correctness, so you do not need every language
before shipping.

The writer's own words — draft, cards, chat — cannot live here. They only exist
at runtime, so they go through `../translation-engine.ts` instead, and only while
a translated view is on screen.

## Generating the dictionaries

You never write these by hand. With the backend running (it holds the API key):

```bash
npm run i18n              # fill in languages that have no file yet
npm run i18n -- --force   # redo every language
npm run i18n -- zh ko     # only these
```

The script reads `source.json`, translates it into every language in
`LANGUAGE_CODES` (read from `../language.ts`, so the two cannot drift), and
writes the files. It is a one-off cost of a few cents, not a runtime cost.

## Growing `source.json`

Interface copy that is not in `source.json` stays English. To find what is
missing, let the app tell you rather than hunting literals through the source:

1. `npm run dev`, switch the page to a non-English language.
2. Walk the interface — open every panel, the Control Room, the recap, and the
   empty and error states. Anything never rendered is never noticed.
3. In the browser console: `copy(__missingUiStrings())` (dev builds only).
4. Merge those strings into `source.json`, then `npm run i18n -- --force`.

Re-run after interface copy changes. A stale dictionary costs coverage, not
correctness.
