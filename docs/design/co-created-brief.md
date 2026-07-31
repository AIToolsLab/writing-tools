# The co-created brief

Status: first slice implemented (draft-from-document proposals). The chat half
and the standalone rubric are open — see [Open questions](#open-questions).

## Where this came from

A writer used the Chat page on a paper draft with this prompt:

> Help me think through a checklist of things that this paper should do
> successfully before we submit it as a registered report. i.e., what are the
> acceptance criteria. Let's aim for no more than a dozen, and keep them clear
> and succinct.

It worked well enough to want as a preset. The obvious home was a fourteenth
button on the Revise feature grid, and that turns out to be the wrong shape for
two reasons.

**It isn't the same kind of thing as the other thirteen.** Every Revise feature
answers *what is in my document?* — outline it, list its claims, find its
counterarguments. This one answers *what would make this document done?* That is
a statement about the goal, not an observation about the text, and it belongs
with the other statements about the goal.

**The Revise result panel is the wrong container for it.** Results there are
read and discarded. Acceptance criteria are the sort of thing you want to still
have next week, and to have shaped what the tool says to you in between.

So it goes to the brief. But the brief has a problem of its own, which is the
actual subject of this document.

## The problem: the brief is incomplete, and the document knows things it doesn't

The brief (`frontend/src/contexts/docBriefContext.tsx`) is three fields —
Audience, Purpose, Constraints — that the writer states and that every page
folds into its requests. It is deliberately modest: *stated*, not negotiated.

In practice it is usually blank or thin, and the reason is structural rather
than lazy. A writer who can crisply state their audience and their success
conditions is a writer who has already done the hardest part of the work. The
ones who most need the brief to exist are the ones least able to fill it in from
a cold start. Meanwhile the draft in front of them is full of evidence about all
three fields — they have been making decisions about audience and purpose in
every paragraph, just not writing those decisions down anywhere.

That asymmetry is the whole design opening: **the brief should be co-created by
the writer and the assistant, grounded in the document, rather than typed from
nothing.**

## What is implemented

A "Draft from my document" action in `BriefSection`. It reads the current draft,
asks for candidate wording for each of the three fields, and renders each
candidate as a provisional card next to its field.

The generalized version of the original prompt lives in
`frontend/src/api/briefProposal.ts`, as the guidance for **Constraints**:

> Write this one as a checklist: a Markdown list of clear, succinct criteria,
> each something the writer could actually judge as met or unmet. No more than a
> dozen, and fewer is better.

"Paper" and "registered report" are not restated in the prompt. They come from
the document and from whatever the writer has already put in the brief, both of
which are in the request — which is what makes it a preset rather than a
one-off.

### The rules it follows

`interface-concepts.md` sets a covenant that this had to be built against, and
two of its clauses do real work here.

**"The writer's sentences are the writer's."** Where the assistant must produce
prose, the artifact is "framed as *draft material to be edited*, rendered in a
visibly provisional style, and inert until the writer touches it." So:

- Candidates never land in a field. They render below it, dashed and tinted, as
  something visibly not yet part of the brief.
- A candidate for a field the writer has already filled in leaves their wording
  untouched and sits alongside it.
- Candidates are session state only. They are held in the brief context but
  deliberately not in `DocBrief`, and never serialized — nothing the writer has
  not agreed to should follow the file to whoever opens it next.
- The only path from candidate to brief runs through `acceptProposal` →
  `setField`, so an accepted candidate is saved, logged, and cleared by exactly
  the same code as text the writer typed.
- Typing into a field clears its candidate. A field the writer has answered
  themselves is a field whose candidate is spent, whether they accepted it or
  ignored it.

**"The writer grades; the AI gathers evidence."** The Constraints checklist is
phrased so each item is something the writer can judge as met or unmet. Nothing
in the add-in marks them met.

### Grounding, and why it's strict

The prompt pushes hard on staying inside the document, and omitting a field
entirely rather than guessing at it. The failure mode is worse than a bad
outline: a plausible invented audience reads as insight, gets accepted without
much scrutiny, and then silently frames every request on every page for weeks.
A blank field is visibly blank. A wrong one is not.

This is also why "nothing to suggest yet" is a real, visible outcome with its
own notice rather than a quiet no-op — and its wording points the writer at the
fact that an undetermined audience is the interesting finding, not a failure.

### What gets logged

`brief_proposal_requested` / `_received` / `_resolved` / `_error`
(`LOG_SCHEMA_VERSION` 5). The one that matters is `_resolved`, which records
accepted vs dismissed per field. If candidates are almost always accepted
unedited, the tool is writing the brief rather than co-creating it, and the
feature has become the thing this document is trying to avoid.

## Open questions

**Chat should be able to propose brief updates.** The direction this is headed:
a conversation on any page can provisionally update any part of the brief, with
the same accept/dismiss mechanic. The plumbing is already shaped for it —
`setProposals` is on the shared context and any page can call it — but the chat
side needs a way to decide *when* to propose without turning every message into
an interruption, which "silence is a feature" says a lot about and this document
does not yet answer.

**Does the readiness checklist deserve to be its own artifact?** Right now it is
Constraints, which is a genuine fit ("what does this have to satisfy?") but a
tight one: a dozen criteria is a lot for one textarea, and criteria are the sort
of thing you want to grade individually rather than keep as one blob of text.

The reason it is not a fourth field is naming. `interface-concepts.md` reserves
the vocabulary a standalone version would need — the Charter's **Rubric** is
exactly "3–6 criteria for success, in the writer's own words," each with
evidence and a writer-set mark. A fourth brief field called "Success criteria"
would squat on that name while providing none of the mechanic. Better to leave
the name free and let Constraints carry the checklist until the Charter is
actually built.

**Is this the Charter's cheapest prototype?** `interface-concepts.md` proposes
Wizard-of-Oz in Chat: a facilitator runs three opening questions and maintains
the Charter as a pinned markdown block, measuring whether writers *edit* the
candidate criteria. What is built here is narrower but real, and it produces the
same measurement from actual use rather than from a facilitated session. Worth
deciding whether it replaces that prototype or feeds it.

## Related

- `docs/design/interface-concepts.md` — Concept 1, the Charter.
- `frontend/src/contexts/docBriefContext.tsx` — the brief and the candidate
  lifecycle.
- `frontend/src/api/briefProposal.ts` — the prompt and its parser.
- Issue #597 — the Revise feature grid, which this deliberately does not touch.
