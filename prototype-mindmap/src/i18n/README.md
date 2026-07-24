# Interface dictionaries

- `source.json` — the canonical list of English interface strings. **The one file
  you edit by hand.**
- `<code>.json` — one generated dictionary per language, mapping each English
  source string to its translation.


`../ui-strings.ts` looks copy up here for the selected UI locale. Every lookup is
synchronous and offline, so changing the interface language re-skins the
application without a provider request.

A string with no entry simply renders in English. A partial or missing dictionary
degrades in coverage, never in correctness, so you do not need every language
before shipping.

The writer's own words — draft, cards, chat, evidence, proposal wording, and
diagnostic payloads — never live here and are never passed to `uiString`.
Checkpoint 1 localizes application chrome only; translated content views are a
later, explicitly read-only capability.

`source.json` inventories fixed English UI strings. Add new application-owned
copy there and to the dictionaries being maintained for the current checkpoint.
Chinese is the complete first target; missing entries in other imported donor
dictionaries intentionally fall back to English.
