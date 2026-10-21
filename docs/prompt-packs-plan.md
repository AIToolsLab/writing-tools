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

1. **Prompt packs (this document).** Inert data — a prompt plus a declared
   set of tool grants — executed by our UI under the user's own session. No
   third-party code runs anywhere, so no sandbox, no token handoff, no merge.
   A domain expert (writing-center director, WAC instructor, clinician
   teaching care-plan writing) can author one, with or without LLM help.
2. **Hosted tools** ([tool-launcher-plan.md](tool-launcher-plan.md)). Real
   code on the author's own origin, talking to the platform through scoped
   grant tokens. For anything that needs its own rendering surface or
   transport (mindmap canvas, voice, a custom editor). See
   [Reuse over invention](#reuse-over-invention) — much of this tier's
   bespoke manifest/protocol design is a candidate for MCP.
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

Note that this shape — a prompt, a tool allowlist, a name and a hint — is
very close to an **MCP prompt** (`prompts/list` / `prompts/get`). See
[What MCP would actually look like here](#what-mcp-would-actually-look-like-here);
the pack format may not need inventing at all.

**Surfaces** — where a pack mounts, which also bounds what it can do:

| Surface | Mounts as | Loop shape | Existing precedent |
| --- | --- | --- | --- |
| `button` | a card/button on Draft (or a Revise action) | one-shot: context in, one `offer`/`annotate` out | the five Draft prompts in `frontend/src/api/prompts.ts` — already pack-shaped data |
| `persona` | a selectable mode in Chat | full conversation with the pack's prompt + tools | `CHAT_INSTRUCTIONS`; my-words walkthrough strategy |
| `lens` | a review pass over the document | iterate the doc, emit `annotate`/`highlight` calls | Revise's feedback flows |
| `ritual` | a prompt at session open/close (or on request) | short `ask_writer` exchange, write a note to the workspace | Tidelines' sixty-second reflection; Post-Game Review |

The built-in pages keep their identity; packs *add rows* to them. First
refactor: the Draft buttons and (per
[#597](https://github.com/AIToolsLab/writing-tools/issues/597)) the Revise
grid become built-in packs read from data, so the runtime has first-party
consumers before any user-authored pack exists.

## The reframe that makes 80% possible

A pack that is *only* a prompt + output format covers the Draft buttons and
little else. The leverage is in the **runtime tool vocabulary**: if the tools
carry the generic capabilities — read the document, point at a passage, offer
cards, ask the writer, keep notes — then the pack itself stays a prompt, and
the prompt is the only part the extension author writes. The tools do the
heavy lifting; the pack supplies judgment about *what to say*.

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

Tools available to a pack's loop, gated by the pack's `tools` list. "Precedent"
= where the mechanism already exists in this repo; "Who needs it" names concepts
from [design/interface-concepts.md](design/interface-concepts.md) and
[design/interaction-concepts.md](design/interaction-concepts.md) plus existing
pages.

### Document (routed to the doc authority / `EditorAPI`)

This group is genuinely ours to build: it is the live document in a real
editor, under the covenant.

| Tool | Essential schema | Who needs it | Precedent | Notes |
| --- | --- | --- | --- | --- |
| `view` | `{} → numbered paragraphs` | nearly everything | my-words `liveResponder`; [#583](https://github.com/AIToolsLab/writing-tools/issues/583) proposes moving it into Chat | Paragraph numbers are loop-internal coordinates, never shown to the writer (my-words rule). |
| `highlight` | `{phrase} → ok \| not_found` | Say-Back, Prior Self (*quote*), Table Read, Marginalia, doctext-style citations | my-words `highlight`; `EditorAPI.selectPhrase`; `docTextLink` | Anchor with a W3C **`TextQuoteSelector`** (exact + prefix/suffix), not a bare needle — see [Reuse over invention](#reuse-over-invention). Fixes [#589](https://github.com/AIToolsLab/writing-tools/issues/589), [#591](https://github.com/AIToolsLab/writing-tools/issues/591), [#592](https://github.com/AIToolsLab/writing-tools/issues/592) once for every pack. |
| `annotate` | `{selector, note, kind} → ok` | Marginalia, Reader's Reply, Table Read, any `lens` pack | Word comment API; Google Docs comments blocked on a Drive scope ([#580](https://github.com/AIToolsLab/writing-tools/issues/580)) | Same selector model. Falls back to an in-pane annotation list where the host can't do margin comments. |
| `propose_edit` | `{selector, replace, rationale} → accepted \| rejected \| not_found` | Blind Rewrite, rewording flows, my-words ops | my-words `str_replace`/`insert`/`move` + propose strategy; rooms plan's patch-with-confirm | **Always** confirm-gated. The `rationale` renders on the confirm card — the writer sees why, not just what. |

The cursor-context (`DocContext`) and the writer's brief are *injected* into
the loop's first message rather than fetched by tool call — every pack wants
them, and `buildMessages` already does exactly this for Draft.

### Writer interaction (rendered by the host page)

| Tool | Essential schema | Who needs it | Precedent | Notes |
| --- | --- | --- | --- | --- |
| `offer` | `{items: [{label, body, kind?}]} → chosen \| dismissed` | every Draft-style pack; Repertoire (*offer, then return*); Predict-the-Reader | Draft's suggestion cards | `kind: "insertion"` items get Draft's insert-at-cursor affordance; default kind is just *shown*. The choice returns to the loop, so a pack can follow up. |
| `ask_writer` | `{question, choices?, free_text?} → answer` | Charter (*negotiate*), Say-Back, Earn-the-Answer, Post-Game Review, Dojo, Stuckness-aware questions | my-words walkthrough strategy; MCP **elicitation** is the same primitive | See below — on the Chat surface this is not about *being able* to ask. |

Plain prose from the loop renders as a chat/panel message through the
existing `<Markdown>`/`DocTextMarkdown` path — narration needs no tool.

**Why `ask_writer` rather than just talking.** On the `persona` surface the
model can obviously ask a question in prose, so the tool has to earn its
place on three other grounds:

1. **Floor control as a mechanism, not an instruction.** The loop *blocks* on
   the answer. A model that asks and then answers itself is
   [#425](https://github.com/AIToolsLab/writing-tools/issues/425), and
   Earn-the-Answer is a concept whose whole point is that the tool cannot
   proceed. Prompting for that is a request; a suspended loop is a
   guarantee — the same move as `propose_edit` being confirm-gated.
2. **Non-chat surfaces.** `button`, `lens` and `ritual` packs have no
   conversational UI. A session-close ritual is not a chat; this is the only
   way it can ask anything.
3. **Typed answers.** `choices` renders as the Charter's ●◐○ grader or a
   scale and returns a *value*, not prose to re-parse — and logs it as a
   schema'd event, which is the difference between hand-coding transcripts
   and having study data.

### Workspace: files and git, not a bespoke memory API

An earlier draft of this document proposed five tools — `remember`, `recall`,
`read_history`, `get_revisions`, `search_corpus`. They collapse into a
**per-`(user, pack)` virtual filesystem with git history**:

| Bespoke tool it replaces | Standard equivalent |
| --- | --- |
| `remember` / `recall` | write / read a file |
| `search_corpus` | `grep` |
| `read_history` | read the pack's log file |
| `get_revisions` | `git log -p`, `git diff` |
| Inkwell-lite (provenance) | `git blame` |

Three reasons this is better than the API I would have written:

- **The idiom is already in the weights.** A model writes shell and git
  fluently; it writes `remember({key, scope})` only as well as our
  documentation explains it. A bespoke API is a small language the model
  learns at inference time from a paragraph we wrote. This is Morrell's
  argument made concrete, and it is the single strongest reason to prefer a
  standard here.
- **It is *more* legible for consent, not less.** "What does this pack
  remember about you" becomes a directory the writer can read, export and
  delete; erasure is removing a namespace. That beats an opaque KV
  inspector.
- **It unlocks cases no bespoke tool had.** A scratchpad; *pasting in real
  feedback from a human reader*; working across several documents. The Table
  Read and Reader's Reply concepts get much stronger when they can run
  against an advisor's actual comments in `feedback/round2.md` instead of a
  simulated reader.

**Tools:** start with a small file set — `ls`, `read_file`, `write_file`,
`grep`, `git_log`, `git_show`/`git_diff` — and treat a real `bash -c` as a
later upgrade if packs turn out to need pipelines. The value is in the
*idiom* being familiar, which the small set already delivers.

**The covenant boundary.** Handing packs a shell-shaped surface only stays
compatible with "the values live in the vocabulary" if the boundary is
explicit:

- **The writer's document is not a writable file in the workspace.** Mount it
  read-only if useful (`doc.md`, regenerated per turn); every mutation still
  goes through confirm-gated `propose_edit`.
- **The workspace has no network.** A pack can compute over its own notes and
  nothing else.
- Scope is per `(user, pack)`; there is no cross-pack read, so no
  exfiltration channel exists to grant.

So the shell is powerful over scratch and memory, and powerless over the
document and the outside world — which is exactly where the covenant needs to
hold.

**Candidate dependencies** (verified to exist; *not* yet vetted for adoption):

| Package | Version | License | Notes |
| --- | --- | --- | --- |
| [`just-bash`](https://github.com/vercel-labs/just-bash) | 3.4.2 | Apache-2.0 | "Simulated bash environment with virtual filesystem", vercel-labs, very active. **Due diligence:** it depends on `undici`, so it may ship network-capable builtins — the no-network boundary above must be verified, not assumed. |
| [`just-git`](https://github.com/blindmansion/just-git) | 1.8.0 | MIT | Pure-TS git over a virtual filesystem, zero dependencies, keywords include `agent`/`sandbox`. |

Both are young (first published Dec 2025 and Mar 2026), so treat the
maturity risk as real: the workspace should sit behind our own thin tool
interface so the implementation underneath can be swapped.

**Where it runs: server-side.** Both packages are dependency-light TypeScript
and could run in the pane, but the backend already exists, a server-side
workspace persists across devices (which the rooms/phone story in the
launcher plan wants), and a server-side sandbox is a real boundary rather
than a browser-side fiction. It also keeps taskpane bundle weight flat.

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

## Who can actually publish?

The founding question of this document is whether a domain expert who is not
a software engineer can extend Thoughtful. That question has to be asked of
every mechanism the document proposes, *including its own distribution
story*. An earlier draft failed it: "a writing center publishes an MCP
server" quietly assumed a public HTTPS endpoint, multi-tenant auth and
someone on call.

The corrective principle: **LLMs made authoring cheap and did nothing to make
operating cheap.** A writing-center director can now produce a working prompt
in an afternoon; they still cannot run a service, and no model will page them
at 2am. So an extensibility ladder built for this era should push
*operations* onto the platform and leave only *authoring* with the extender.
Any mechanism that fails this test is a mechanism for us and for Tier-2
developers, and should be labelled as such rather than offered to a domain
expert.

| # | Mechanism | Skill demanded | Who hosts | Verdict |
| --- | --- | --- | --- | --- |
| 0 | Author a pack in Chat | conversation | us | the target |
| 1 | Share a pack with a colleague | send a link or a code | us | the target |
| 2 | Publish a **collection** others subscribe to | naming, curation, writing a description — editorial, not technical | us | **the target; this is what "a writing center publishes" has to mean** |
| 3 | Host pack files yourself at a URL | static hosting (GitHub Pages, a university web directory), git | them | fine as an option; required of no one |
| 4 | Run an MCP server | server code, TLS, OAuth, uptime, incident response | them | out of reach — and unnecessary, see below |

The rule that follows: **anything we expect a domain expert to do must sit at
level ≤ 2, and level 2 must be something we host.**

### Collections: the actual distribution primitive

A collection is a named set of packs with an owner and a visibility setting —
Google-Docs-shaped sharing, not app-store-shaped publishing. It lives on our
infrastructure as ordinary data, so:

- publishing is clicking Share and naming the thing;
- subscribing is opening a link;
- an update propagates to subscribers **with the change shown**, because a
  pack is a prompt that will run against someone else's document and silent
  edits to that are not acceptable;
- provenance and version history come from the collection record rather than
  from the author's infrastructure.

Level 3 stays available for anyone who wants to own the canonical copy — a
collection can point at a static URL or a git repo of pack files, which costs
GitHub Pages rather than a server. It should never be the only path.

**What hosting distribution costs us.** This is not a free win, and the cost
is exactly why self-hosting was tempting to write down. A shared pack is an
untrusted prompt that runs against someone else's document, so hosting
distribution makes us a distribution platform: provenance display, a report
path, a policy on what a public collection may contain, and some answer for a
pack that is hostile rather than merely bad. One-to-one sharing is
low-stakes; a public gallery is a different product with different duties.
Sequence accordingly — private sharing and named collections first, anything
resembling a directory only once we are willing to own moderation.

### So what is MCP for?

Not distribution. **The writing center is a pack author, not a server
operator**, and in the MCP relationship it is a *consumer*: one of its packs
can declare a server somebody else already runs — Zotero, a library
catalogue, an LMS vendor, a campus system maintained by IT. That is Role 1
below, and it asks nothing of the pack's author beyond naming it. Where no
such server exists, the honest answer is that the integration waits for
someone to build it, and that someone is a Tier-2 developer.

## Reuse over invention

The test is not "does a standard exist" but: **is the idiom already in both
the model's weights and the domain expert's head?** Files, git and grep pass
twice over. Build bespoke only for (a) the writer's live document, (b) the
covenant, (c) the research instrument.

| Concern | Verdict |
| --- | --- |
| Storage, scratch, corpus search, revision history | **Reuse** — virtual filesystem + git (above) |
| Tool protocol; hosted extensions | **Reuse — MCP** (`@modelcontextprotocol/sdk`). Retires much of the bespoke manifest design in the launcher plan; see below |
| Asking the writer a question | **Reuse the shape** — MCP elicitation is `ask_writer` |
| Identity / auth | **Already reused** — OAuth 2 device flow (RFC 8628) via Better Auth. Evidence the instinct works |
| Phrase anchoring ([#589](https://github.com/AIToolsLab/writing-tools/issues/589), [#591](https://github.com/AIToolsLab/writing-tools/issues/591), [#592](https://github.com/AIToolsLab/writing-tools/issues/592)) | **Reuse** — W3C Web Annotation `TextQuoteSelector` (exact + prefix/suffix) is specified for exactly this; `diff-match-patch` for fuzzy location. Currently hand-rolled three ways |
| Annotations / marginalia | **Reuse** — same W3C Web Annotation data model |
| Multi-surface transport (rooms) | **Steal the model, not the wire** — see below |
| Document access, `propose_edit`, consent gating, log tenancy, pack semantics | **Build** — Office.js/Docs reality, the covenant, the study instrument |

**On XMPP.** The mapping is uncannily good: MUC is the launcher plan's rooms,
presence is its presence, pubsub is its `broadcast`, and federation is the
multi-institution research case. But adopting it means running
Prosody/ejabberd, bridging over BOSH or WebSocket, XML payloads — and we
would still define every message body ourselves. That is a server and an ops
burden for a small lab in exchange for a vocabulary we can copy for free.
Recommendation: **name the primitives after XMPP's model** (presence, MUC,
pubsub) so the protocol is conventionally shaped, and spend the standards
budget on MCP, where the actual interop lives.

## What MCP would actually look like here

MCP is worth more than a line in a table, because in this setting it has
three distinct roles and they have very different risk profiles.

**The mapping is closer than it first looks.** MCP's primitives line up
against this design almost one for one:

| MCP primitive | Our equivalent |
| --- | --- |
| **Tools** | the runtime tool vocabulary above |
| **Resources** (read-only, URI-addressed) | the document, the brief, workspace files — `thoughtful://doc/current`, `thoughtful://scratch/feedback.md`. A better fit than tools for injected context |
| **Prompts** (server-exposed, user-selectable, templated) | **a prompt pack** |
| **Elicitation** (server asks the *user* a question) | `ask_writer` |
| **Sampling** (server asks the client for a completion) | our LLM proxy relationship, inverted |

That third row is the striking one: a pack is very nearly already an MCP
prompt, so the pack *format* may not need inventing.

**Pack distribution is a different question, and MCP is the wrong answer to
it.** Serving prompts over MCP means running a live server with a public
endpoint, auth and uptime — more engineering than the monorepo PR this whole
ladder exists to avoid, demanded of the person least able to supply it. Packs
are static data; distributing them needs no server. See
[Who can actually publish?](#who-can-actually-publish).

### Role 1: Thoughtful as MCP *client* (outbound) — the real unlock

A pack declares a third-party MCP server alongside its prompt. "Check my
citations against my Zotero library", "pull the rubric from our course LMS",
"look it up in the library catalogue" stop being things we have to build.
The domain expert composes an extension out of a prompt plus somebody else's
server, and nobody hosts anything for us.

This is the cheapest large win on the whole ladder, and it is strictly
additive: it needs no changes to the covenant, because third-party servers
supply *information*, not document authority. The work is a consent screen
naming the server and its tools, per-server scoping, and the usual
untrusted-content discipline — tool results from an external server are data,
never instructions, and must not be able to redirect a pack's loop.

### Role 2: platform tools *defined* in MCP shape (internal) — cheap, do early

Define the document/workspace/writer tools with MCP-shaped schemas even while
they run in-process in the taskpane. This costs almost nothing (it is a
schema convention) and means one set of definitions serves the in-pane loop,
the outbound case, and Role 3 later.

**What does not fit:** the doc authority is a webview with no inbound
address, so document tools cannot sensibly be *served* over a network
transport — MCP over stdio is irrelevant here and MCP over HTTP would have to
reach back into the pane, which is the switchboard problem the launcher plan
already owns. Keep document tools in-process; MCP is for the outward-facing
surfaces.

### Role 3: Thoughtful as MCP *server* (inbound) — powerful, values-fraught

Exposing the writer's document and workspace as an MCP server means their own
Claude, ChatGPT or Cursor could reach it: "my advisor's feedback is in my
Thoughtful scratchpad." That is a genuinely new capability and the most
obvious "extended in ways we hadn't thought about" surface.

It is also the sharpest values question in this document. An external agent
holding `propose_edit` is an excellent pipe for precisely the
write-my-paper-for-me workflow the lab exists to resist — and unlike a pack,
an outside client is not running under our UI, so none of the confirm-gating
or covenant lives there. The scope grant is the only thing that travels.

The defensible position is that **the outbound server exposes reading and
asking, never writing**: `view`, resources, `grep` over the workspace,
possibly `annotate`; never `propose_edit`, never silent document mutation.
Read access still deserves a consent screen and its own `client_id` for
attribution. Worth prototyping precisely *because* it forces the question of
which parts of the covenant are properties of our UI and which are properties
of the platform — the answer should be "the platform", and this is the test.

### Costs, honestly

- Multi-tenant hosted MCP with per-user scoped tokens is newer and rougher
  than the local single-user case; expect OAuth-per-server plumbing.
- MCP has no notion of "this field is document text, strip it at the
  `usage` consent level" — our consent gate (`src/consent.ts`) has to wrap
  every boundary, in both directions.
- An MCP client in the pane is just JSON-RPC, but bundle weight in a taskpane
  is a real budget.

## Coverage: which concepts become packs

Checked against the current concept inventory. Tools listed are beyond `view`
plus injected context, which everything uses.

| Concept | Surface | Tools needed | Verdict |
| --- | --- | --- | --- |
| Draft's five buttons | button | `offer` | pack today — they are already data in `prompts.ts` |
| Revise's feedback grid ([#597](https://github.com/AIToolsLab/writing-tools/issues/597)) | lens | `highlight`, `annotate` | pack |
| First Read, Say-Back, Reader's Reply, Predict-the-Reader, Who Is Served? | persona / lens | `highlight`, `offer`, `ask_writer` | pack — several were "prompt-only" as their cheapest honest prototype already |
| **Table Read** | persona | `annotate`, `ask_writer` | pack — and much stronger with real reader feedback in the workspace |
| Earn-the-Answer, Stuckness-aware questions, Dojo | persona | `ask_writer`, `offer` | pack |
| Marginalia | lens | `annotate` | pack |
| Blind Rewrite | button | `ask_writer`, `propose_edit` | pack |
| **Charter** | persona + ritual | `ask_writer`, workspace files, `highlight` | pack (its cheapest test was literally "WoZ in Chat") |
| Intent Ledger | ritual | workspace files | pack |
| **Repertoire** | ritual + button | `offer`, workspace files + log | pack |
| **Tidelines** | ritual | workspace, `git_log`/`git_diff` | pack, given doc snapshotting |
| Post-Game Review | ritual | workspace log, `git_diff` | pack, same gate |
| **Prior Self** | lens | `grep` over corpus, `highlight` | pack once a corpus lands in the workspace |
| Citation / source checking *(new)* | lens | outbound MCP (Zotero, catalogue) | pack — enabled by MCP Role 1, previously not on the list at all |
| **Loom** | — | needs a full-window custom editor | Tier 2 (hosted tool) |
| Skim View / Reading Playback | — | custom rendering/animation | Tier 2 |
| Inkwell (provenance ink) | — | deep editor instrumentation | Tier 2 (an honest subset via `git blame` might pack) |
| Mindmap prototype | — | own canvas | Tier 2 (the launcher plan's motivating case) |
| My Words voice | — | realtime audio transport | Tier 2 |

Score: **~14 of 19 concepts (~75–80%) become packs**, and the concentration
is instructive. `offer` + `ask_writer` + `highlight`/`annotate` alone cover
roughly ten of them; the **workspace** (files + git) subsumes what was going
to be four more bespoke tools and covers the stateful and longitudinal
concepts; outbound MCP adds a category that was not previously imaginable
without us building an integration. The honest 20% is anything needing **its
own rendering surface or transport** — exactly where the hosted-tool tier
begins, so the two plans meet cleanly: a pack that outgrows the sidebar
graduates to a manifest and a grant token, not to a monorepo PR.

## Security and consent posture

- **Packs are inert data.** No pack-supplied code executes; the UI executes.
  The threat model is prompt-shaped, not code-shaped.
- **A shared pack is an untrusted prompt.** It runs with the *user's own*
  session and only the tools it declares. Blast radius: read the doc it was
  invoked on, compute over its own workspace, say things, propose
  confirm-gated edits. No network tool, no cross-pack workspace read.
- **Import is the consent screen**: full prompt, tool list, and any
  third-party MCP servers it wants, shown before first run.
- **Tool results from third-party MCP servers are untrusted data**, never
  instructions — the loop must not let them redirect the pack or escalate its
  tool grants.
- **Attribution:** `pack_id` alongside `client_id` on `llm_usage` and the log
  envelope. Per-pack quotas reuse the per-tool quota machinery when it lands
  (launcher plan Phase 3). Note [#578](https://github.com/AIToolsLab/writing-tools/issues/578)
  — grant tokens minting fresh grants — as the analogous mistake not to
  repeat with pack scopes.
- **Workspace state is visible and erasable**: a directory the writer can
  read, export and delete, covered by the existing erasure flow.
- **Content in tool results obeys the consent gate** exactly as log payloads
  do (`src/consent.ts`), which depends on that gate being default-closed
  ([#615](https://github.com/AIToolsLab/writing-tools/issues/615)).

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
   `offer`. Define tool schemas in MCP shape from the start (Role 2). No user
   authoring yet — this proves the format on code we already trust.
2. **Chat gets `view` + `highlight`** ([#583](https://github.com/AIToolsLab/writing-tools/issues/583),
   already filed) via the shared loop runner lifted out of my-words, with
   `TextQuoteSelector` anchoring that also closes
   [#589](https://github.com/AIToolsLab/writing-tools/issues/589)/[#591](https://github.com/AIToolsLab/writing-tools/issues/591)/[#592](https://github.com/AIToolsLab/writing-tools/issues/592).
3. **User pack storage + paste-to-import**, with the consent screen.
   Draft renders the user's `button` packs below the built-ins.
4. **Self-extension:** `save_pack` / `test_pack` / `list_packs` in Chat;
   provenance cards.
5. **Collections** — share one pack with a colleague, then named collections
   with subscribe and update-with-diff. Hosted by us (level ≤ 2); a
   collection may optionally point at an author-hosted static URL. Public
   directories deliberately excluded until moderation is owned.
6. **`ask_writer` + `annotate` + the `persona`/`lens`/`ritual` surfaces** —
   the dialogic tier.
7. **The workspace** (server-side VFS + git, behind our own tool interface).
   Charter becomes buildable as a pack, which is a good acceptance test.
   Document snapshotting as commits unlocks Tidelines and Post-Game Review.
8. **Outbound MCP** (Role 1) — packs may declare third-party servers.
9. **On demand:** `propose_edit`, corpus import, and — as a deliberate,
   separately-argued step — inbound MCP (Role 3, read-only).

Steps 1–4 are the minimum for "extensions prompt themselves into
existence"; step 5 is what lets anyone but the author benefit from one; 6–8
are where the coverage table's 80% actually arrives.
