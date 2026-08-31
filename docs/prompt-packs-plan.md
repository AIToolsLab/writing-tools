# Prompt Packs and the Self-Extending Sidebar

Design exploration for the lowest tier of the extensibility ladder: extensions
as **declarative prompt packs** rather than hosted code, and Chat as the
environment where writers and domain experts author them — conversationally,
without a PR and without being software engineers.

> **Status:** Proposal. Nothing here is implemented. Companion to
> [tool-launcher-plan.md](tool-launcher-plan.md), which covers the hosted-tool
> tier (grants, rooms, manifests); this document covers what should *not* need
> any of that machinery.
>
> Background reading that frames the goal: Dubakov,
> [*Malleable software: solid bases, custom code*](https://www.mdubakov.me/malleable-software-solid-bases-custom-code/);
> Morrell, [*Extensible software in the age of LLMs*](https://jeremymorrell.dev/blog/extensible-software-in-the-age-of-llms/).

## The extensibility ladder

Today the project has two rungs: *use the app* and *PR the monorepo*. The
merge gate on the second rung is doing work it shouldn't — it is the only
thing standing between "trusted" and "untrusted" extensions, so every
extension costs a review and a deploy. The plan is three tiers, with trust
carried by the *shape* of each tier rather than by review:

1. **Prompt packs (this document).** Inert data — a prompt plus a small set
   of tool grants — executed by our UI under the user's own session. No
   third-party code runs anywhere, so no sandbox, no token handoff, no merge.
   A domain expert (writing-center director, WAC instructor, clinician
   teaching care-plan writing) can author one, with or without LLM help.
2. **Hosted tools** ([tool-launcher-plan.md](tool-launcher-plan.md)). Real
   code on the author's own origin, talking to the platform through scoped
   grant tokens. For anything that needs its own rendering surface or
   transport (mindmap canvas, voice, a custom editor).
3. **Platform PRs.** Reserved for new *primitives* — a new tool in the
   vocabulary below, a new pack surface, a new scope. This is the one tier
   where the merge gate belongs, because primitives encode policy.

The platform succeeds when things migrate *down* this ladder: a concept that
today would be a feature branch should become a pack.

## What a pack is

A pack is a small JSON document. Format sketch (field names provisional):

```jsonc
{
  "pack": 1,                        // format version
  "id": "advisors-questions",       // slug, unique per owner
  "name": "Advisor's Questions",
  "hint": "The three questions Prof. Okafor would ask",  // navbar-style hint
  "surface": "button",              // where it mounts — see below
  "prompt": "You are helping a writer anticipate their advisor's...",
  "tools": ["view", "offer"],       // granted subset of the runtime vocabulary
  "provenance": {
    "author": "user:…",             // or "builtin"
    "created": "2026-08-31",
    "origin": "chat"                // authored in conversation vs. imported
  }
}
```

Execution: the pack's `prompt` becomes the `instructions` of a tool loop (the
manual loop pattern proven in
`frontend/src/pages/my-words/interaction/liveResponder.ts` — tools carry
schemas but no `execute`; the app routes each call), restricted to the tools
the pack declares. The loop runs through the existing LLM proxy under the
user's own session; `pack_id` joins `client_id` in the usage and log
attribution.

**Surfaces** — where a pack mounts, which also bounds what it can do:

| Surface | Mounts as | Loop shape | Existing precedent |
| --- | --- | --- | --- |
| `button` | a card/button on Draft (or a Revise action) | one-shot: context in, one `offer`/`annotate` out | the five Draft prompts in `frontend/src/api/prompts.ts` — already pack-shaped data |
| `persona` | a selectable mode in Chat | full conversation with the pack's prompt + tools | `CHAT_INSTRUCTIONS`; my-words walkthrough strategy |
| `lens` | a review pass over the document | iterate the doc, emit `annotate`/`highlight` calls | Revise's feedback flows |
| `ritual` | a prompt at session open/close (or on request) | short `ask_writer` exchange, `remember` the answer | Tidelines' sixty-second reflection; Post-Game Review |

The built-in pages keep their identity; packs *add rows* to them. First
refactor: the Draft buttons and (per
[#597](https://github.com/AIToolsLab/writing-tools/issues/597)) the Revise
grid become built-in packs read from data, so the runtime has first-party
consumers before any user-authored pack exists.

## The reframe that makes 80% possible

A pack that is *only* a prompt + output format covers the Draft buttons and
little else. The leverage is in the **runtime tool vocabulary**: if the tools
carry the generic capabilities — read the document, point at a passage, offer
cards, ask the writer, remember something — then the pack itself stays a
prompt, and the prompt is the only part the extension author writes. The
tools do the heavy lifting; the pack supplies judgment about *what to say*.

This is also where the lab's values are enforced structurally rather than by
review. `docs/design/interface-concepts.md` closes with the observation that
the verbs that survived sketching were *ask, quote, notice, gather,
resurface, narrate, believe, doubt, offer, fade* — never *write* or *fix*.
The tool vocabulary below is that verb list made executable. The covenant
("what the AI never does") holds for every pack anyone ever authors because
**there is no silent-write tool to grant**: the strongest document verb is
`propose_edit`, which is confirm-gated by construction. Curating this
vocabulary — not reviewing individual packs — is the maintainers' job.

## Runtime tool vocabulary

Tools available to a pack's loop, gated by the pack's `tools` list. Grouped
by what they touch. "Precedent" = where the mechanism already exists in this
repo; "Needs it" names concepts from
[design/interface-concepts.md](design/interface-concepts.md) and
[design/interaction-concepts.md](design/interaction-concepts.md) plus
existing pages.

### Document (routed to the doc authority / `EditorAPI`)

| Tool | Essential schema | Who needs it | Precedent | Notes |
| --- | --- | --- | --- | --- |
| `view` | `{} → numbered paragraphs` | nearly everything | my-words `liveResponder`; [#583](https://github.com/AIToolsLab/writing-tools/issues/583) proposes moving it into Chat | Paragraph numbers are loop-internal coordinates, never shown to the writer (my-words rule). |
| `highlight` | `{phrase} → ok \| not_found` | Say-Back, Prior Self (*quote*), Table Read, Marginalia, doctext-style citations | my-words `highlight`; `EditorAPI.selectPhrase`; `docTextLink` | Phrase matching is the known-fragile part: [#589](https://github.com/AIToolsLab/writing-tools/issues/589), [#591](https://github.com/AIToolsLab/writing-tools/issues/591), [#592](https://github.com/AIToolsLab/writing-tools/issues/592). Fix once, every pack benefits. |
| `annotate` | `{phrase, note, kind} → ok` | Marginalia, Reader's Reply, Table Read, any `lens` pack | Word comment API; Google Docs comments blocked on a Drive scope ([#580](https://github.com/AIToolsLab/writing-tools/issues/580)) | Falls back to an in-pane annotation list where the host can't do margin comments. |
| `propose_edit` | `{find, replace, rationale} → accepted \| rejected \| not_found` | Blind Rewrite, rewording flows, my-words ops | my-words `str_replace`/`insert`/`move` + propose strategy; rooms plan's patch-with-confirm | **Always** confirm-gated. The `rationale` renders on the confirm card — the writer sees why, not just what. |

The cursor-context (`DocContext`) and the writer's brief are *injected* into
the loop's first message rather than fetched by tool call — every pack wants
them, and `buildMessages` already does exactly this for Draft.

### Writer interaction (rendered by the host page)

| Tool | Essential schema | Who needs it | Precedent | Notes |
| --- | --- | --- | --- | --- |
| `offer` | `{items: [{label, body, kind?}]} → chosen \| dismissed` | every Draft-style pack; Repertoire (*offer, then return*); Predict-the-Reader | Draft's suggestion cards | `kind: "insertion"` items get Draft's insert-at-cursor affordance; default kind is just *shown*. The choice returns to the loop, so a pack can follow up. |
| `ask_writer` | `{question, choices?, free_text?} → answer` | Charter (*negotiate*), Say-Back, Earn-the-Answer, Post-Game Review, Dojo, Stuckness-aware questions, any Socratic pack | my-words walkthrough strategy | The tool that makes packs *dialogic* instead of oracular. A `ritual` surface is essentially one `ask_writer` plus one `remember`. |

Plain prose from the loop renders as a chat/panel message through the
existing `<Markdown>`/`DocTextMarkdown` path — narration needs no tool.

### Memory and history (the new platform primitives)

| Tool | Essential schema | Who needs it | Precedent | Notes |
| --- | --- | --- | --- | --- |
| `remember` | `{key, value, scope: "doc" \| "user"} → ok` | Charter (criteria + grades), Intent Ledger, Repertoire, Tidelines (exemplars), Loom (threads) | doc scope: `documentSettings` / the brief. user scope: **new** backend KV, namespaced `(user, pack)` | The single most enabling addition. Without it every stateful concept needs a hosted backend, i.e. Tier 2. |
| `recall` | `{prefix?, scope} → entries` | same as `remember` | — | Both scopes surface in an inspectable "what this pack remembers" UI — memory the writer can read and delete, matching the erasure story. |
| `read_history` | `{kinds?, since?, limit} → own pack's logged events` | Tidelines, Post-Game Review, Repertoire's return-visit | JSONL logs already keyed `(user, client_id)`; consent levels in `src/consent.ts` | Read-back is scoped to the *pack's own* events and filtered to the user's consent level. Depends on the consent gate being default-closed ([#615](https://github.com/AIToolsLab/writing-tools/issues/615)). |
| `get_revisions` | `{since} → doc snapshots/diffs` | Tidelines, Post-Game Review, Prior Self (within one doc), Inkwell-lite | none — **new capability**: periodic snapshotting by the doc authority | The hardest row on this table; consent-heavy (it is a copy of the document over time). Defer until a pack demands it, but design the log envelope so it can. |
| `search_corpus` | `{query} → passages from the writer's provided corpus` | Prior Self (*retrieve, contradict*), My Words | `my-words/corpus.ts` | Requires a corpus-upload story first; the tool itself is then small. |

### Authoring tools (Chat only — never grantable to a pack)

This is the self-extension loop: Chat gets these tools in its ordinary
conversation, so "make that a button" is something the writer can just say.

| Tool | Essential schema | What it enables | Notes |
| --- | --- | --- | --- |
| `save_pack` | the full pack object (zod-validated) `→ ok \| validation errors` | reifying a conversational behavior into a persistent pack | Validation errors bounce back as tool errors and the model retries — the schema is the reliability mechanism. Upsert by `id` covers editing. |
| `test_pack` | `{pack} → transcript of a dry run against the current document` | rehearsal before saving | Catches packs overfitted to the conversation they were born in. The transcript is shown to the writer, not just the model. |
| `list_packs` / `get_pack` | `{} → summaries` / `{id} → pack` | editing, composing ("like my Say-Back pack but for abstracts") | Also how Chat answers "what packs do I have?" |

The saved pack lands with `provenance.origin: "chat"` and its prompt is
displayed in full on its settings card. **Legibility is the trust story**: a
pack is inspectable in a way code never is, and the writer who authored one
by talking can read exactly what they made.

## Coverage: which concepts become packs

Checked against the current concept inventory. Tools listed are beyond
`view` + injected context, which everything uses.

| Concept | Surface | Tools needed | Verdict |
| --- | --- | --- | --- |
| Draft's five buttons | button | `offer` | pack today — they are already data in `prompts.ts` |
| Revise's feedback grid ([#597](https://github.com/AIToolsLab/writing-tools/issues/597)) | lens | `highlight`, `annotate` | pack |
| First Read, Say-Back, Reader's Reply, Predict-the-Reader, Who Is Served? | persona / lens | `highlight`, `offer`, `ask_writer` | pack — several were "prompt-only" as their cheapest honest prototype already |
| **Table Read** | persona | `annotate`, `ask_writer` | pack |
| Earn-the-Answer, Stuckness-aware questions, Dojo | persona | `ask_writer`, `offer` | pack |
| Marginalia | lens | `annotate` | pack |
| Blind Rewrite | button | `ask_writer`, `propose_edit` | pack |
| **Charter** | persona + ritual | `ask_writer`, `remember`/`recall`, `highlight` | pack (its cheapest test was literally "WoZ in Chat") |
| Intent Ledger | ritual | `remember`/`recall` | pack |
| **Repertoire** | ritual + button | `offer`, `remember`, `read_history` | pack |
| **Tidelines** | ritual | `remember`, `read_history`, `get_revisions` | pack, gated on the history rows |
| Post-Game Review | ritual | `read_history`, `get_revisions` | pack, same gate |
| **Prior Self** | lens | `search_corpus`, `highlight` | pack once a corpus service exists |
| **Loom** | — | needs a full-window custom editor | Tier 2 (hosted tool) |
| Skim View / Reading Playback | — | custom rendering/animation | Tier 2 |
| Inkwell (provenance ink) | — | deep editor instrumentation | Tier 2 (an honest subset via `get_revisions` might pack) |
| Mindmap prototype | — | own canvas | Tier 2 (the launcher plan's motivating case) |
| My Words voice | — | realtime audio transport | Tier 2 |

Score: **~14 of 19 concepts (~75–80%) become packs** given the vocabulary
above — and the concentration is instructive. `offer` + `ask_writer` +
`highlight`/`annotate` alone cover roughly ten of them; `remember`/`recall`
adds the stateful four; `read_history`/`get_revisions`/`search_corpus` are
each demanded by only two or three concepts but are the ones nothing else can
substitute for. The honest 20% is anything that needs **its own rendering
surface or transport** — which is exactly the boundary where the hosted-tool
tier begins, so the two plans meet cleanly: a pack that outgrows the sidebar
graduates to a manifest and a grant token, not to a monorepo PR.

## Security and consent posture

- **Packs are inert data.** No pack-supplied code executes; the UI executes.
  The threat model is therefore prompt-shaped, not code-shaped.
- **A shared pack is an untrusted prompt.** It runs with the *user's own*
  session and only the tools it declares, so the blast radius is: it can read
  the doc it was invoked on, say things, and propose confirm-gated edits.
  There is no network tool and no cross-pack `recall`, so no exfiltration
  channel exists to grant. Import shows the full prompt and the tool list as
  the consent screen — the same move as the launcher plan's manifest consent,
  minus the token.
- **Attribution:** `pack_id` alongside `client_id` on `llm_usage` and the log
  envelope. Per-pack quotas can reuse the per-tool quota machinery when it
  lands (launcher plan Phase 3).
- **Memory is visible and erasable.** `remember`ed state appears on the
  pack's settings card and is covered by the existing erasure flow.
- **Content in tool results obeys the consent gate** exactly as log payloads
  do (`src/consent.ts`) — `read_history` returns what the user's level
  permits, nothing more.

## What this buys the research program

`pack_id` on every event makes the packs themselves a study instrument:
which packs do writers create, keep, iterate, share, abandon — and what do
domain experts build when building costs a conversation instead of an
engineering collaboration? That is an end-user-programming-of-writing-support
study the current architecture is one attribution column away from
supporting.

## Phasing

1. **Packs as data, first-party only.** Extract the Draft buttons (and the
   Revise grid, [#597](https://github.com/AIToolsLab/writing-tools/issues/597))
   into built-in pack files; a small runtime executes `button` packs with
   `offer`. No user authoring yet — this proves the format on code we already
   trust.
2. **Chat gets `view` + `highlight`** ([#583](https://github.com/AIToolsLab/writing-tools/issues/583),
   already filed) via the shared loop runner lifted out of my-words.
3. **User pack storage + paste-to-import.** The backend KV for packs
   themselves; an import screen that shows prompt + tools. Draft renders the
   user's `button` packs below the built-ins.
4. **Self-extension:** `save_pack` / `test_pack` / `list_packs` in Chat;
   provenance cards.
5. **`ask_writer` + `annotate` + `persona`/`lens`/`ritual` surfaces** — the
   dialogic tier.
6. **`remember`/`recall`** (user-scope KV) — the stateful tier; Charter
   becomes buildable as a pack, which is a good acceptance test.
7. **On demand:** `read_history`, `get_revisions`, `search_corpus`,
   `propose_edit` — each lands when the first concrete pack needs it, not
   before.

Steps 1–4 are the minimum for "extensions prompt themselves into existence";
5–6 are where the coverage table's 80% actually arrives.
