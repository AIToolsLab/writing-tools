# Reproducing "Designing Proactive Thought Partners for Writing" in Thoughtful

Source: Zhang, Davis, Chen & Hsu, *Designing Proactive Thought Partners for
Writing*, arXiv:2609.01588v1 (Sept 2026).

This document is two things: a mapping from the paper's probe onto this
add-in, and a **running log of the challenges** the reproduction hit. It is
written to be argued with — several entries are judgment calls that could
reasonably have gone the other way, and they are marked as such.

---

## 1. What the paper actually built

The probe (paper §4) is a Next.js app with a BlockNote markdown editor and a
right-hand suggestion panel. Its moving parts:

| Part | Paper §4 | Detail |
|---|---|---|
| Session goal | §4 onboarding | User states writing goals for the session |
| Partner config | §4.1 | name + emoji, **role**, **event trigger(s)**, **contextual heuristic** |
| Event triggers | §4.2 | Long Pause (5s default), Sentence End (1s idle after `.!?`), Text Selection (5s idle) — rule-based, over **keystrokes** |
| Decision engine | §4.2 | On a trigger, an LLM gets goal + document + writing behaviours (cursor position, trigger, **15s keystroke log**) + enabled partners; picks **at most two** whose heuristics match |
| Suggestion | §4.3 | Activated partner produces **acknowledgement** (what the writer seems to be doing) + a **question-style suggestion** |
| Engagement | §4.4 | *Ignore* (tag fades after 15s), *Inspire* (click tag → card, optional follow-up chat), *Execute* ("Help Me Write" inserts/revises text, then accept/revert) |
| Models | §4.5 | `gemini-2.5-flash-lite` for the decision engine (<1s), `gemini-2.5-flash` for suggestions (~8s) |

Note: the paper says its prompts are "provided in the supplementary
materials". **The arXiv PDF contains no such appendix** — pages 24–30 are
references only. So every prompt here is reconstructed from the prose
descriptions in §4.2–§4.3, not transcribed. Any behavioural difference from
the paper could be a prompt difference and we would not be able to tell.

## 2. The reproduction target

Thoughtful is not a web app that owns its own editor. It is a **task-pane
add-in** that lives beside Word, Google Docs, or a standalone Lexical editor,
reaching the document through the host-agnostic `EditorAPI`
(`frontend/src/types.d.ts`). That single fact causes most of the challenges
below.

Implemented as a **lab page** (`frontend/src/pages/partners/`), reachable from
the Labs (···) menu. Lab tier, not core: the registry caps core tabs at three
and this is a probe, not a product.

---

## 3. Challenge log

### C1 — There are no keystrokes to log. *(blocking, worked around)*

The paper's triggers are "rule-based and operate on user keystrokes monitored
in real time within the editor" (§4.2), and the decision engine is fed "the
keystroke logs from the 15 seconds before the trigger" (§4.2).

In a task pane, the writer types into a *different application*. Office.js
exposes `DocumentSelectionChanged` and nothing finer; Google Docs exposes no
selection event at all (see the comment in `frontend/src/utilities/index.tsx`
— the Apps Script bridge has to re-fetch the whole document). There is no
character-level event stream on any host, and no timing information about
individual keys.

**Workaround:** poll `EditorAPI.getDocContext()` on an interval and diff
consecutive snapshots into a coarse *activity trace* — text length delta,
whether the change was an insertion or a deletion, cursor movement, selection
changes — keeping a rolling 15-second window to stand in for the keystroke
log. See `frontend/src/pages/partners/signals.ts`.

**What is lost:** intra-word pause structure, burst/pause rhythm, backspace
runs, and anything else the keystroke-analysis literature the paper cites
(Baaijen, Galbraith, Bixler & D'Mello) actually depends on. Our "writing
behaviour" is a much thinner signal than theirs. This is the single biggest
fidelity gap in the reproduction, and it is not closeable on Word or Google
Docs — it is a platform limit, not an implementation shortcut.

**Not taken:** the standalone editor (`frontend/src/editor/`) is Lexical
running in *our own* page, so real keystrokes are available there. Building
the triggers against Lexical would reproduce the paper faithfully on exactly
one surface and not at all on the two that writers actually use. Targeting
the lowest common denominator was the call; it is arguable.

### C2 — Polling has a per-host cost the paper never pays.

The paper's triggers cost nothing: they are local event listeners. Ours cost a
host round-trip per tick. In Word that is a `Word.run` sync; in Google Docs it
is an Apps Script call that fetches the whole document.

**Workaround:** one poll interval (`POLL_MS`), deliberately slack, and the
poll is suspended whenever the page is hidden or the partner list is empty.

**What is lost:** trigger latency is now quantised to the poll interval, so
"5-second pause" means "5 to 5+POLL_MS seconds". The Sentence End trigger,
which the paper fires after a **1 second** idle, is the one that suffers: at a
1s poll the detection is barely finer than the thing being detected. Google
Docs will be worse still.

### C3 — "Aligned with the user's current cursor position" is not available.

The paper's floating tags appear in the right-side panel *vertically aligned
with the writer's cursor* (§4.2, Fig. 5). A task pane cannot know where the
cursor is on screen — it has no access to the host's rendering geometry, only
to a character offset.

**Workaround:** tags appear at a fixed position in the panel.

**What is lost:** the spatial coupling between the suggestion and the text it
is about. Since the paper's §6 findings specifically credit "lightweight
visual representations" for feeling non-intrusive, this is a fidelity gap that
touches one of the paper's actual conclusions, not just its plumbing.

### C4 — "Execute" / "Help Me Write" conflicts with this project's covenant. *(deliberate omission)*

The paper's deepest engagement form has the partner "insert or revise text
directly in the editor" (§4.4). This repository's stated design commitment is
the opposite: `docs/design/interface-concepts.md` opens its shared covenant
with "**The writer's sentences are the writer's.** The AI quotes, asks,
points, and arranges," and `frontend/CLAUDE.md` states as fact that "nothing
in the add-in rewrites the writer's prose."

**Decision:** *Ignore* and *Inspire* are implemented; **Execute is not.**

This is the one place where a faithful reproduction and the host project's
values genuinely diverge, so it is flagged rather than silently resolved. The
machinery to build it exists (`EditorAPI.applyEdit`), so this is a decision to
revisit, not a capability gap. Note that any study run on this build cannot
speak to the paper's findings about Executing.

### C5 — Two models become one.

The paper uses a cheap fast model for the decision engine and a stronger one
for suggestions, and reports the split matters: the tag appears in <1s while
the suggestion takes ~8s, which is what makes the perceived latency tolerable.

Thoughtful proxies a single model (`OPENAI_MODEL` in
`frontend/src/api/openai.ts`); adding a second means a backend pricing-table
entry (`backend/src/pricing.ts`) or the usage summary reports `cost: null`.

**Workaround:** both calls use the shared model, but the *interaction* shape
is preserved — the tag renders as soon as the decision returns, and the
suggestion is generated lazily, only when the writer clicks the tag. The
paper generates eagerly; generating on click means an unclicked suggestion
costs nothing, which matters more here because our triggers are noisier (C1).

**What is lost:** the paper's sub-second tag latency. Ours is one full model
call. If tags feel sluggish, this is why.

### C6 — Where do partners live?

The paper's partners are per-user, reusable across sessions, configured
before a session starts.

`EditorAPI` offers exactly one persistence primitive — `getDocumentSetting` /
`setDocumentSetting`, which is *document*-scoped and follows the file. There
is no user-scoped store that works on all three surfaces.

**Decision:** partners are stored with the document, alongside the writer's
brief. Defensible (a partner like "Evidence Partner" is usually about *this*
piece) but it is not what the paper did, and it means a writer re-creates
their partners per document until a user-scoped store exists.

### C7 — Session goal: reuse, not rebuild.

The paper's onboarding panel collects the session's writing goals. Thoughtful
already has the **brief** (audience / purpose / constraints,
`contexts/docBriefContext.tsx`), which is the same information in a shape this
codebase has already argued about.

**Decision:** reuse the brief rather than add a second goal field. This is
arguably *better* than the paper (the brief is structured), and it is a
deviation regardless.

### C8 — Trigger noise, and a cooldown the paper does not have.

With keystrokes, a "long pause" is one unambiguous event. With polling, every
tick where nothing changed looks like a pause, and a writer who stops to think
for two minutes generates one pause plus a lot of ambiguity about whether it
is still the same pause.

**Workaround:** each trigger fires at most once per quiet period / per
selection, plus a global cooldown between activations.

**What is lost:** the cooldown is a parameter the paper does not have, and it
directly shapes how proactive the system feels — which is the paper's whole
subject. Findings about intrusiveness on this build are partly findings about
this constant.

<!-- Entries below are appended as the build proceeds. -->

---

## 4. Challenges found by running it

C1–C8 were predicted from reading the paper. These two were not: they only
appeared once the thing was driven in a browser, typing into a real editor.
Both are consequences of polling rather than listening, which is the
reproduction's central compromise — so they are worth recording as evidence
about that compromise rather than as ordinary bugs.

### C9 — A polled observer has no history from before it starts.

Its very first snapshot is indistinguishable from "text the writer just
typed", so whatever is already in the document becomes the baseline, and
anything written in the gap before that baseline is invisible. A writer who
switched watching on and immediately typed a sentence and stopped got no
pause at all: the burst had been absorbed into the baseline, so as far as the
state machine knew, they had never written anything.

Mitigated by sampling the baseline the instant watching starts rather than on
the first interval, which shrinks the blind window from a full poll interval
to one host read. It cannot be closed. A keystroke listener has the same cold
start, but its resolution is one character, so its blind window is invisible.

### C10 — An unwatched trigger was spending the cooldown. *(fixed)*

A writer whose only partner listened for **Long pause** received nothing,
ever. Every sentence they finished fired a **Sentence end** — which no partner
listened for, so it produced no activation — but firing it started the 45-second
cooldown, and the pause that followed was suppressed behind it. The feature
looked completely dead while every individual part of it worked.

Fixed by evaluating only the triggers some partner actually listens for
(`observe`'s `watched` argument), with a regression test.

Worth dwelling on rather than just fixing: **the cooldown is not a neutral
safety valve.** It is a scarce resource that the noisiest trigger wins by
default. That is a property of the cooldown itself, not of this bug — so the
same dynamic will shape which partners get heard in any study run on this
build. A writer with one Sentence-end partner and one Long-pause partner is
not running two partners at equal odds; the sentence-end one will take most of
the openings. The paper has no cooldown and so has no such effect, which makes
this a place where our findings could diverge from theirs for reasons that
have nothing to do with the design being studied.

## 5. Status

| Paper §4 | Here |
|---|---|
| Partner customization (name, emoji, role, triggers, heuristic) | ✅ |
| Long Pause / Sentence End / Text Selection triggers | ✅ from polled snapshots, not keystrokes (C1) |
| Session goal | ✅ as the existing document brief (C7) |
| Keystroke log fed to the decision engine | ⚠️ coarse activity trace instead (C1) |
| Decision engine, at most two partners | ✅ one model instead of two (C5) |
| Acknowledgement + question suggestion | ✅ generated on click, not on activation (C5) |
| Floating tag aligned with the cursor | ⚠️ fixed position in the panel (C3) |
| Ignoring — tag fades after 15s | ✅ |
| Inspiring — card plus follow-up conversation | ✅ |
| Executing — partner writes into the document | ❌ deliberately not built (C4) |

Verified end-to-end in `frontend/tests/partners-flows.spec.ts`: a writer
configures a partner, types, stops, and a tag appears; opening it produces the
suggestion and a follow-up reply. That test is what surfaced C9 and C10.

**Not yet verified:** anything on a real host. Everything above ran against
the standalone Lexical editor, where reading the document is a function call.
On Word each poll is a `Word.run` sync and on Google Docs an Apps Script
round-trip, and whether a 1.5-second poll is tolerable there — in battery,
latency, and the host's own responsiveness — is an open question this
reproduction has not answered.
