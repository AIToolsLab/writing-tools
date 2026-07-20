# Five New Interfaces for Thoughtful Writing

*Design sketches, storyboards, and worked examples — July 2026*

> Contributing to a flourishing world requires thought.
> We build AI tools to support sustained goal-directed cognitive effort
> despite unclear goals and complex situations.

This document sketches five interface concepts for the writing-tools frontend.
None of them are specced for implementation; they are low-fi provocations meant
to be argued with. Each one includes a wireframe, a storyboard with a worked
example, an account of what the AI pointedly does *not* do, and the cheapest
honest way to test it.

The existing three pages each own one moment of writing: **Draft** helps when
the cursor is stuck, **Revise** helps when the document exists but the shape is
wrong, **Chat** helps when the writer needs to talk it out. What none of them
own is *the writer's relationship to the work over time*: where the work is
going, what the writer already has, and who the writer is becoming. That's the
territory these five concepts explore.

---

## Prologue: an imagined salon

*(Entirely fictional, obviously — a warm-up exercise, not scholarship.)*

Somewhere outside of time, a seminar room. Coffee. A whiteboard that never
runs out of space.

**Vannevar Bush:** The problem is not generating text. Any fool machine can
generate text now, apparently. The problem is that a writer's own prior
thought is scattered and inaccessible. We built trails for civilization's
record; nobody built trails for a single person's record.

**Doug Engelbart:** And the point of the trails was never retrieval. It was
*augmenting* the person — co-evolving the tool and the intellect. If the tool
does the thinking, the intellect atrophies. The tool must make the thinking
*more possible*, not less necessary.

**Ted Nelson:** Also, stop flattening everything! A serious piece of writing
is not a scroll of characters. It is a tangle — versions, transclusions,
side-notes, roads not taken. Every editor ever shipped pretends the tangle
doesn't exist, and every serious writer maintains the tangle anyway, in their
head or in seventeen misnamed files.

**Lucy Suchman:** Be careful with all this machinery. Plans are resources for
action, not programs that run people. Whatever goal the writer states on
Monday is a *situated* artifact — it will and should drift by Thursday. Design
for the drift, or the tool becomes a nag.

**Seymour Papert:** And ask what the writer *learns*. A tool the writer can't
eventually outgrow is a cage. The best gear to give someone is gear to think
with — and then you must be willing to let them stop needing it.

**Mark Weiser:** One more thing. The most dangerous default in this decade is
the assistant that always has something to say. Silence is a feature. The
tool should be calm — present at the periphery, vivid only when summoned.

**Peter Elbow:** You're all describing the doubting game. Don't forget the
believing game. A writer needs one reader who first says "let me inhabit this
fully" before anyone says "here is what's broken." Most software readers only
doubt.

**Muriel Cooper:** Then show it, don't say it. Information wants a landscape.
If the writer's goals, threads, and history matter, give them *form* — not
another list of gray bullets.

The five concepts below are what they might have left on the whiteboard.

---

## Shared covenant: what the AI never does

All five concepts inherit these commitments (several are already implicit in
Draft/Revise/Chat; here they are made explicit):

1. **The writer's sentences are the writer's.** The AI quotes, asks, points,
   and arranges. Where it must produce prose (candidate criteria, thread
   names), the artifact is framed as *draft material to be edited*, rendered
   in a visibly provisional style, and inert until the writer touches it.
2. **The writer grades; the AI gathers evidence.** No scores, no green
   checkmarks bestowed by the machine. Judgments of quality and done-ness are
   writer-set; the AI's contribution is observations linked to specific text.
3. **Goal drift is data, not failure.** Every artifact that encodes intent
   (rubric, thread, plan) is versioned and cheerfully renegotiable.
4. **Silence is a feature.** Nothing interrupts composition. Proactive
   observations accumulate quietly and are presented at natural pauses or on
   request.
5. **The tool aims at its own obsolescence** wherever the concept is
   developmental: scaffold, then fade.

---

# Concept 1 — The Charter
### The writer and AI negotiate what "good" means, then organize the work around it

**Seed:** "writer and AI co-create a todo list and/or rubric for successful
outcome and use that to organize their work."

**Lineage:** Engelbart's co-evolution; Suchman's plans-as-resources; the
Flower & Hayes observation that expert writers spend their effort on *goal
formation*, not transcription. Also the best of all three existing pages:
Chat's negotiation, Revise's document-anchored evidence, Draft's low-friction
nudges — but all pointed at one durable artifact.

## The idea

Most writing tools assume the goal is known and only the text is missing. For
the writing that matters most — proposals, difficult emails, theses, position
papers — it's the reverse: text is easy to emit, and the goal is the fog.

The Charter makes the goal itself a first-class, co-authored, *editable*
artifact with two halves:

- **Rubric** — 3–6 criteria for success, in the writer's own words, each
  phrased as something a specific reader would experience ("A skeptical dean
  finds the budget section airtight"), not as abstract virtues ("clarity").
- **Worklist** — a small Now / Next / Later list, where items are born from
  gaps between the draft and the rubric.

The Charter is *negotiated*, never generated-and-accepted. The AI's opening
move is questions, not answers. Its candidate criteria arrive as editable
scraps in a visually "wet ink" style, and nothing enters the Charter until the
writer has rewritten or explicitly kept each one.

Once a Charter exists, the whole pane reorganizes around it. Every AI
observation must cite which criterion it serves. A criterion with no recent
evidence goes visually quiet ("dormant") — a gentle prompt to either work on
it or admit it no longer matters and renegotiate.

## Wireframe (Word task pane, ~380px)

```
┌──────────────────────────────────────────┐
│  CHARTER            [history ▾] [renew]  │
│                                          │
│  What success means (yours to edit):     │
│                                          │
│  ● 1. The provost can repeat my core     │
│       argument in one sentence.          │
│       └ evidence: 2 for · 1 against  ▸   │
│                                          │
│  ◐ 2. A skeptical dean finds the         │
│       budget section airtight.           │
│       └ evidence: 1 against          ▸   │
│                                          │
│  ○ 3. Reads in under 6 minutes.          │
│       └ no evidence yet — dormant        │
│                                          │
│  (●◐○ set by YOU, never by the AI)       │
│                                          │
│──────────────────────────────────────────│
│  WORKLIST                                │
│  NOW   ▸ Cite the $40k figure (→ #2)     │
│  NEXT  ▸ Cut the history section? (→ #3) │
│  LATER ▸ One-sentence version of the     │
│          argument, for the cover email   │
│                                          │
│  [＋ add]        [ask: what am I missing]│
│──────────────────────────────────────────│
│  ✎ The Charter is 9 days old and you've  │
│    stopped touching #3. Renegotiate?     │
└──────────────────────────────────────────┘
```

Tapping a criterion's `evidence ▸` opens a Revise-style list of doctext links:

```
┌──────────────────────────────────────────┐
│  #2 "A skeptical dean finds the budget   │
│      section airtight."                  │
│                                          │
│  FOR                                     │
│  · ¶14 breaks cost into per-student      │
│    terms — concrete, checkable   [go →]  │
│                                          │
│  AGAINST                                 │
│  · ¶16 asserts "roughly $40k" with no    │
│    source. A skeptical reader stops      │
│    here.                         [go →]  │
│                                          │
│  The AI collects evidence. You set ●◐○.  │
│  [mark ◐]  [mark ●]  [this criterion     │
│                       no longer matters] │
└──────────────────────────────────────────┘
```

## Storyboard: Mia's curriculum proposal

**Frame 1 — fog.** Mia has 400 words of throat-clearing for a proposal to the
faculty senate. She opens the pane. It does not offer to write. It asks three
questions, one at a time: *Who has to say yes? What will they be afraid of?
What happens if this document simply doesn't exist?*

**Frame 2 — candidate criteria.** From her typed answers, the AI drafts five
criteria in wet-ink style. One reads "The proposal demonstrates innovative
pedagogy." Mia deletes it — that's resume language, not success. Another
reads "The provost can repeat my core argument in one sentence." She keeps it
verbatim, slightly startled that it's true.

**Frame 3 — the worklist is born.** The AI compares draft to Charter and
proposes two worklist items, each citing a criterion. Mia adds a third
herself. Hers goes to NOW.

**Frame 4 — working.** Days pass. Mia writes in Word; the pane stays quiet.
When she pauses long enough, small evidence counts update. She clicks
criterion #2, reads the AGAINST item, mutters "fine," and goes to fix ¶16.
She — not the AI — flips #2 from ◐ to ●.

**Frame 5 — the renegotiation.** Day 9: the pane notes that criterion #3
("under 6 minutes") is dormant and the draft is now 9 minutes long. Mia
realizes the real constraint was never length; it was the provost's
attention. She rewrites #3 as "The first page works as a standalone summary."
The old criterion isn't deleted — it's visible in `history ▾`, a fossil record
of her own thinking. That history *is* the picture of goal formation.

## Why it serves the values

This is the concept aimed most directly at "unclear goals": it treats goal
clarification as *the work*, gives it an artifact, and then uses that artifact
to make effort goal-directed for weeks, not minutes. Self-assessment against
co-authored criteria is where the thought lives; the AI just keeps the
evidence honest.

## Risks & open questions

- Will writers do the negotiation, or reflexively accept all five candidates?
  (Mitigation: nothing is accepted by default; wet-ink items expire if
  untouched.)
- Rubrics can calcify. Is the "dormant" mechanic enough to keep the Charter
  situated rather than bureaucratic?
- Does evidence-gathering degrade into nagging for short documents? Charter
  is probably wrong for anything under ~a day of work.

## Cheapest honest prototype

Wizard-of-Oz in the existing Chat page: a facilitator (human or prompt-only)
runs the three opening questions and maintains the Charter as a pinned
markdown block. No new UI. Measure: do writers *edit* the candidate criteria?
Do they refer to the Charter unprompted in later sessions?

---

# Concept 2 — The Prior Self
### A librarian for everything you've already written, made, and half-finished

**Seed:** "the writer may have a bunch of related content… how could the AI
help the writer leverage things they've already written or work they've
already done, even if they're not sure where it even is?"

**Lineage:** Bush's memex trails, pointed inward at one person's corpus;
Nelson's transclusion-with-provenance; Weiser's calm periphery.

## The idea

The writer connects sources they already own: a Drive folder, a git repo,
past documents, meeting notes. The AI builds a private **atlas** of this
material and then plays exactly one role: *librarian of your past self*. It
never writes new prose in this mode. Its entire vocabulary is excerpts,
locations, and relationships.

Three interactions:

1. **"You've been here before" cards.** At natural pauses, the margin surfaces
   at most one card: an excerpt from the writer's own material that bears on
   the paragraph just written — a 2023 memo paragraph, a docstring, an
   abandoned draft's better version of the same idea. Peripheral, dismissible,
   never modal.
2. **Provenance-first quotation.** Inserting from a card places a visibly
   *linked quote of yourself* — source-marked, styled as borrowed — which the
   writer is expected to rewrite in place. Until rewritten, it's listed as a
   **debt**. The debt ledger replaces the copy-paste guilt spiral with an
   explicit, finishable list.
3. **"Where did I say this?"** — a search box whose answers are always
   excerpts-in-context, never summaries. The point is to put the writer's eyes
   back on their own words.

The defining constraint: **the atlas can contradict you.** Because the corpus
includes artifacts with ground truth (code, data, published versions), the
librarian's most valuable card is often a discrepancy.

## Wireframe

```
┌──────────────────────────────────────────┐
│  PRIOR SELF          [atlas: 4 sources ▾]│
│                                          │
│  ┌ You've been here before ─────────────┐│
│  │ Your doc (¶8): "the client retries   ││
│  │ three times before failing over"     ││
│  │                                      ││
│  │ repo/src/retry.ts, updated May 12:   ││
│  │   const MAX_RETRIES = 5;             ││
│  │                                      ││
│  │ [open source] [quote it] [dismiss]   ││
│  └──────────────────────────────────────┘│
│                                          │
│  DEBTS — borrowed from yourself,         │
│          not yet rewritten:              │
│  · ¶3  from "Q3 postmortem" (Drive)      │
│  · ¶11 from design-doc-v2, §Goals        │
│                                          │
│──────────────────────────────────────────│
│  Where did I say this?                   │
│  ┌──────────────────────────────────────┐│
│  │ that thing about idempotency keys    ││
│  └──────────────────────────────────────┘│
│  3 places, excerpts below — your words,  │
│  not a summary.                          │
└──────────────────────────────────────────┘
```

## Storyboard: Sam documents the system the repo already implements

**Frame 1.** Sam is writing an architecture doc for a service he built eight
months ago. He connects the repo and his team's Drive folder. The atlas
builds in the background; the pane shows only "4 sources, ~1,300 items" — no
eager summary of his life's work.

**Frame 2.** He writes from memory: "the client retries three times before
failing over." At his next pause a single card appears: his own `retry.ts`,
`MAX_RETRIES = 5`, changed in May — with the commit message. The tool doesn't
say "you're wrong"; it puts the two texts side by side and lets Sam do the
noticing. This is the librarian at its best: it didn't improve his prose, it
kept his document true.

**Frame 3.** Later he needs to explain the failover rationale and knows he
wrote it well *somewhere*. He types "why we chose regional failover" into
*Where did I say this?* Three excerpts return: a postmortem, a Slack-export
note, an ADR. The ADR paragraph is genuinely good. He hits **quote it**.

**Frame 4.** The paragraph lands in his doc in borrowed-text styling, and a
debt appears in the ledger. Friday afternoon, Sam works down the debt list,
rewriting each borrowed passage for the new audience. The ledger empties. The
final document contains only sentences Sam wrote or rewrote — but it took half
the archaeology.

## Why it serves the values

"Complex situations" often means *distributed prior work*. Effort that
re-derives what you already knew is effort stolen from new thought. The Prior
Self makes past cognition cumulative — and does it without ever taking over
the writing, because its entire output is the writer's own words, relocated.

## Risks & open questions

- Retrieval quality is the whole game; a librarian who mostly mis-shelves
  gets fired. Card precision must be tuned brutally high (better to show
  nothing than something 70% relevant).
- Privacy gradient: an atlas of everything you've written is intimate.
  Sources must be opt-in per folder/repo, with a visible, revocable manifest.
- Does the debt ledger shame instead of help? Framing matters: debts are
  *finishable*, celebrated at zero, never counted as a failure metric.

## Cheapest honest prototype

No new UI: a Revise-page prompt over a manually-concatenated corpus file
("here are 20 of my old documents; when my draft overlaps or conflicts with
them, show the excerpt and location"). Measure: how often the shown excerpt
gets the writer to open the original — that click is the whole concept.

---

# Concept 3 — Tidelines
### A coach that works through your real writing, over months, and fades

**Seed:** "Coach someone to become a better writer, over an extended time,
through what they are in the process of writing?"

**Lineage:** Vygotsky's zone of proximal development; scaffolding-and-fading;
Papert's tools you outgrow; deliberate practice (one skill, real material,
tight feedback); Elbow's insistence that the writer's own voice is the thing
being developed, not replaced.

## The idea

Every existing page treats each document as an island. Tidelines watches — 
with explicit consent — *patterns across documents* and turns them into a
curriculum taught entirely through the writing the person is already doing.
No exercises, no gamification, no scores.

The mechanics:

1. **One focus skill at a time,** chosen together. The AI proposes from
   observed patterns ("in your last four documents, the main claim first
   appears on average in ¶6"); the writer picks or overrules. The focus skill
   is a lens: during a session, the coach comments *only* through it. A coach
   who mentions everything teaches nothing.
2. **Your own best work is the exemplar.** Instead of "here's how good writers
   do it," the coach shows the writer's own strongest instance: "your March 3
   memo led with the claim — that opening, as a model for this one."
3. **Fading, on purpose.** Early: the coach points ("this opening buries the
   claim — it's in sentence 4"). Middle: it asks ("where does the claim first
   appear here?"). Late: it's silent unless summoned, and when summoned it may
   just say: *you already know what I'd say — what would I say?* When the
   writer answers correctly twice running, the skill is offered for
   retirement, and a new focus is negotiated.
4. **The tideline itself.** Progress is shown not as a score but as a shelf of
   the writer's own before/after sentences over months — high-water marks of
   actual language. Reading your own tideline is the reward.
5. **Sixty seconds of reflection** closes each session: the writer writes it
   (the coach only asks the question), and those reflections become the
   coach's memory and the writer's own record.

## Wireframe

```
┌──────────────────────────────────────────┐
│  TIDELINES        focus: LEAD WITH THE   │
│                   CLAIM  · week 5 · ~fading
│                                          │
│  This session, I'll only look through    │
│  that lens. Everything else: silence.    │
│                                          │
│  ┌ (coach, asked — not volunteered) ────┐│
│  │ Where does the claim first appear    ││
│  │ in this draft?                       ││
│  │                                      ││
│  │ (your March 3 memo led with it —     ││
│  │  [see your own exemplar])            ││
│  └──────────────────────────────────────┘│
│                                          │
│──────────────────────────────────────────│
│  YOUR TIDELINE                           │
│                                          │
│  Feb  "This memo provides an overview   │
│        of several considerations…"       │
│  Apr  "Three things went wrong in Q1;   │
│        one of them is fixable by June." │
│  Jun  "Cancel the vendor contract.      │
│        Here's why."                      │
│                                          │
│  These are all yours.                    │
│──────────────────────────────────────────│
│  end session → 60-second reflection      │
│  retired skills: hedging (May) ✓         │
└──────────────────────────────────────────┘
```

## Storyboard: Jordan, six months

**Frame 1 — consent and diagnosis.** Jordan, who writes weekly program
updates, opts in to cross-document memory. After three documents, Tidelines
offers two observed patterns and asks Jordan to pick one focus or name their
own. Jordan picks "lead with the claim."

**Frame 2 — pointing (weeks 1–2).** In each session the coach marks, at pause
points, where the claim actually surfaces — a single quiet underline, through
the one lens only. Jordan's instinct to open with background gets visible.

**Frame 3 — asking (weeks 3–5).** The coach stops marking and starts asking:
"Where does the claim first appear?" Jordan finds it themselves, faster each
week. One session, the coach shows Jordan's own February opening next to this
week's — no commentary. Jordan laughs out loud at the difference.

**Frame 4 — fading (week 6+).** The coach is silent. Jordan summons it once;
it answers: *you already know what I'd say.* Jordan writes the answer in the
reflection box instead. The skill is offered for retirement; the tideline
keeps the fossil record. A new negotiation begins: verbs, this time.

**Frame 5 — the shelf.** Six months in, Jordan scrolls the tideline: a dozen
of their own sentences, February to July. Nobody graded anything. The
evidence of growth is the language itself.

## Why it serves the values

"Sustained" is the operative word: this is the only concept whose horizon is
the writer's development rather than any document's completion. It converts
everyday writing into deliberate practice — and, by fading, it takes the
group's central claim seriously enough to bet the interface on it: a tool for
thought should leave more thinker behind than it found.

## Risks & open questions

- Longitudinal memory demands real trust infrastructure: what's remembered,
  where it lives, one-tap forgetting.
- Can pattern-detection over a handful of documents be honest, or will it
  confabulate trends? Early diagnoses should be phrased as observations with
  the receipts attached ("¶6, ¶4, ¶7, ¶5 — see for yourself").
- Fading needs a real mastery signal; two-right-answers is a placeholder.
- One lens at a time is a strong bet. Some writers may experience it as
  withholding. (Elbow would say: good.)

## Cheapest honest prototype

A month-long diary study with a prompt-engineered Chat persona given the
writer's last N documents and a fixed focus skill, plus a shared doc as the
tideline. Measure: does the writer start pre-empting the coach — answering the
lens question before asking?

---

# Concept 4 — The Loom
### A second surface for the long project: threads, layers, and try-on structures

**Seed:** "helping writers organize their work long term in a document, with
complex thinking-heavy threads to pull on, working towards emerging goals,
incorporating layers of feedback and research, finding sources that may
someday be relevant, exploring different possible structures…"

**Lineage:** Nelson's tangle made visible; Bush's trails; Cooper's information
landscapes; Bereiter & Scardamalia's knowledge-*transforming* (vs. knowledge-
telling) model of expert writing.

## The idea

Serious long-form work has a structure that isn't the outline: it's a set of
**threads** — live questions and tensions the writer is pulling on — each
gathering fragments, sources, feedback, and doc locations over weeks. Today
that tangle lives in the writer's head and seventeen misnamed files. The Loom
gives it a surface. (This one wants the full-window `editor.html` host, not
the task pane; the pane gets a read-only "what's live" summary.)

Elements:

- **Threads, not sections.** A thread is a question or tension: *"Is the
  framing economic or moral?"* — not a heading. Threads hold pinned fragments,
  sources, feedback excerpts, and links into the document. Writer-created;
  the AI may *suggest* a thread when it notices one operating unnamed.
- **Layers of feedback.** Advisor comments, reviewer 2, your own margin
  doubts — each is a toggleable layer pinned to threads and doc locations, so
  contradictory feedback becomes *visible as contradiction* instead of as
  anxiety.
- **The someday shelf.** A zero-friction inbox for sources not yet relevant.
  The AI's job is patience: when a shelved item becomes pertinent to what was
  written *this week*, it quietly resurfaces it. Nothing is deleted; things
  are **composted** — out of view, still nourishing search.
- **Try-on structures.** Candidate orderings of the document exist as cheap,
  disposable *arrangements* of threads (Arrangement A: economic-first;
  Arrangement B: moral-first). The AI's role is narrator, not architect: "In
  B, the reader meets the cost data before knowing why it matters; ¶22 breaks
  first." Try-ons are never auto-applied to the document.
- **Noticing.** The AI's default verb across the whole surface. New paragraph
  seems to join thread 2; it also contradicts a layer-2 comment pinned there;
  both facts get pinned side by side, and the writer decides what they mean.

## Wireframe (full-window editor host)

```
┌──────────────┬────────────────────────────────┬──────────────────┐
│ THREADS      │  DOCUMENT (yours, untouched)   │ LAYERS           │
│              │                                │ ☑ advisor (9)    │
│ ● Economic   │  …¶22 The district's cost per  │ ☑ reviewer 2 (4) │
│   or moral   │  student has risen 34% while…  │ ☐ my doubts (11) │
│   framing?   │      ▲                         │                  │
│   12 pins    │      │ pinned: thread ●,       │ SOMEDAY SHELF    │
│              │      │ advisor: "why do we     │ · Tocqueville ch.│
│ ● What does  │      │ care? lead with harm"   │ · 2019 audit pdf │
│   reviewer 2 │      │ reviewer 2: "more data  │ · that podcast   │
│   actually   │      │ up front"               │                  │
│   want?      │      │ (these two disagree —   │ ⟲ resurfaced:    │
│   4 pins     │      │  pinned side by side)   │ "2019 audit" —   │
│              │                                │ relates to ¶22   │
│ ○ Title?     │                                │ written Tuesday  │
│   composted  │                                │                  │
├──────────────┴────────────────────────────────┴──────────────────┤
│ TRY-ON STRUCTURES (arrangements — never auto-applied)            │
│ [A: economic-first]  [B: moral-first]  [＋ new arrangement]      │
│ B: reader meets cost data before knowing why it matters;         │
│    ¶22 breaks first. — noticed, not decided                      │
└───────────────────────────────────────────────────────────────────┘
```

## Storyboard: Dr. Okafor's article, weeks 1–6

**Frame 1 (week 1).** She dumps her mess in: draft, advisor's comments, two
PDFs, a note that says "moral framing??" The Loom asks her to name one thread.
She types *"Is the framing economic or moral?"* The AI suggests a second
thread it noticed operating unnamed: "What does reviewer 2 actually want?"
She accepts it, amused and slightly stung.

**Frame 2 (week 2).** Reading a book chapter, she flings a reference at the
someday shelf in one gesture. No filing decision required. It sinks out of
sight.

**Frame 3 (week 3).** She drafts ¶22 (cost data). At her next pause the Loom
has pinned it to the framing thread — alongside the advisor's month-old
comment "lead with harm, not cost" and reviewer 2's "more data up front."
The two pieces of feedback sit visibly side by side, disagreeing. For weeks
this contradiction has been a background dread; now it is an *object* — 
lookable-at, discussable, finite. She writes a doubt into her own layer:
"maybe the framings are the same argument at different scales?"

**Frame 4 (week 4).** That doubt won't leave her alone. She builds Arrangement
B (moral-first) in ten minutes by dragging threads. The AI narrates the
reader's walk through it and flags where ¶22 breaks. She doesn't adopt B — but
B teaches her what the introduction owes the reader, and she rewrites it.
The arrangement gets composted, having done its job.

**Frame 5 (week 5).** The shelf stirs: the 2019 audit PDF, shelved a month
ago, relates to the paragraph she wrote Tuesday. It resurfaces with the
connection stated in one line. She cites it. Patience, automated.

**Frame 6 (week 6).** The article ships. The Loom's tangle — threads, layers,
composted arrangements — remains as the project's fossil record, searchable
when the *next* related article begins. Nothing she thought was lost.

## Why it serves the values

This is the concept built for "complex situations" at full strength: emerging
goals (threads rename and split), layered conflicting feedback (made visible
instead of anxious), long-horizon material (a shelf with automated patience),
and structural exploration priced cheap enough to actually do. The document
stays untouched throughout; the Loom is a thinking surface *beside* it.

## Risks & open questions

- Gardens become chores. If thread upkeep costs more than it returns, the
  Loom dies in a week. Every pin the AI can place quietly, it should; every
  writer action must pay back within the session.
- Two surfaces risk divorce: the Loom must feel like *the same work* as the
  document (bidirectional links everywhere), not a parallel bureaucracy.
- Scope: this is the biggest build of the five. It is also the one a
  Word task pane can't hold.

## Cheapest honest prototype

Paper first, truly: one researcher-participant runs a real 4-week project
with threads/layers/shelf maintained by hand in a shared doc, with an LLM run
nightly over the day's writing to produce "noticings." Measure: which
noticings get *used* — and whether the contradiction-made-visible moment (the
single most valuable frame above) actually lands.

---

# Concept 5 — The Table Read
### Rehearse your document in front of readers who believe first, then doubt

**Lineage:** Elbow's believing game / doubting game, in that order and never
reversed; the theater practice of the table read; the existing Draft page's
"reader perspective" button, grown into a room.

## The idea

Writers can't watch people read. The Table Read stages it: the writer casts a
tiny panel of readers grounded in their *actual* stakeholders (a skeptical
dean; a hurried program officer; a first-year student), then runs the
document as a performance in two mandatory acts:

- **Act I — the believing pass.** Every reader inhabits the document as
  generously as possible: *here is what I understood you to be saying, at
  your strongest.* If a reader can't produce a strong believing account of a
  section, that absence is the feedback — no criticism needed.
- **Act II — the doubting pass.** Only after Act I: where each reader stalls,
  skips, or pushes back, paragraph by paragraph, in character.

Reactions render as a **reading trace** along the document: a thin line per
reader that runs smooth, hesitates (re-read), thins (skimming), or breaks
(stopped, with a question). Marginal reactions are in-character and quoted to
specific text. The writer ends by writing their own one-line verdict per act —
the tool asks, the writer judges.

The casting step is itself reflection: to cast the panel you must answer *who
actually reads this, and what do they walk in wanting?* — a question most
writers have never been asked by software.

## Wireframe

```
┌──────────────────────────────────────────┐
│  TABLE READ                              │
│  cast: [dean 🜁] [officer 🜂] [student 🜃] │
│  act:  ▶ I — believing    ○ II — doubting│
│                                          │
│  ¶1  ───────  ───────  ───────           │
│  ¶2  ───────  ──~~───  ───────           │
│  ¶3  ───╳     ───────  ──···──           │
│       │                                  │
│  🜁 dean, ¶3 (believing): "I take the    │
│  author to be arguing that cost and      │
│  fairness are the same case — I can't    │
│  yet retell the fairness half."          │
│                                          │
│  (No fixes offered. The trace is the     │
│   feedback. What you do with it is       │
│   the writing.)                          │
│                                          │
│  [run Act II]   [recast panel]           │
│──────────────────────────────────────────│
│  your verdict on Act I (one line):       │
│  ┌──────────────────────────────────────┐│
│  │                                      ││
│  └──────────────────────────────────────┘│
└──────────────────────────────────────────┘
```

## Storyboard, compressed

**Frame 1.** Rosa is about to send a funding memo. Casting the panel forces
the realization that the real reader is not "the committee" but one hurried
program officer reading on a phone between meetings. That reframe alone
changes her opening.

**Frame 2 — Act I.** The believing pass comes back. The officer's generous
retelling of her argument is *better organized than her memo*. She steals the
order of her own argument back from her reader's summary — Elbow's game
working exactly as designed.

**Frame 3 — Act II.** The doubting pass: the officer's trace breaks at ¶3
("what does this cost me?" arrives three paragraphs too late) and thins to a
skim across her methodology section. The student persona, cast as a
naive-reader control, sails through ¶3 — so the problem is officer-specific:
it's about stakes, not clarity.

**Frame 4.** No rewrite suggestions appear anywhere. Rosa types her verdict —
"move costs to ¶2, cut half the method" — which is to say: Rosa, not the
panel, writes the revision plan.

## Why it serves the values

Audience-modeling is among the heaviest cognitive lifts in writing, and the
one writers most often skip under load. The Table Read doesn't do the lift —
it builds the gym: simulated consequence, believing before doubting, and a
verdict box that keeps the judgment where it belongs.

## Risks & open questions

- Simulated readers can be confidently wrong about real ones; personas must
  be visibly fictional instruments ("cast," "act," "in character"), never
  presented as prediction.
- Act discipline matters: doubting-first is the industry default and it
  produces defensive writers. The order is load-bearing and should be
  non-configurable.
- Trace visualizations can over-claim precision. Lines should be sketchy by
  design — this is a rehearsal, not telemetry.

## Cheapest honest prototype

Prompt-only, in Chat, today: two fixed personas, two acts, quoted-to-text
reactions. Measure: does the writer's own verdict differ from what a generic
"give me feedback" prompt would have told them? (If not, the room adds
nothing over the note.)

---

## The five at a glance

| | Horizon | Fog it addresses | Host surface | AI's verb | Cheapest test |
|---|---|---|---|---|---|
| **Charter** | one document, weeks | what does success mean? | task pane | *negotiate, evidence* | WoZ in Chat |
| **Prior Self** | one document + a life of material | where is what I already know? | task pane margin | *retrieve, contradict* | corpus-file prompt |
| **Tidelines** | the writer, months | how do I get better? | task pane, tiny | *point → ask → fade* | diary study |
| **Loom** | a project, seasons | too many live threads | full editor window | *notice, resurface* | hand-run 4 weeks |
| **Table Read** | one reading, minutes | who is this for, really? | task pane | *believe, then doubt* | prompt-only |

They compose: a Charter criterion can cast the Table Read panel ("a skeptical
dean…" is already a persona); Loom threads can carry Charter evidence; the
Prior Self's atlas is the natural memory for Tidelines' exemplars. But each
stands alone, and each is testable for under a week of effort at the
"cheapest honest prototype" tier.

## Three principles that emerged in the sketching

1. **Give fog a form.** Unclear goals, contradictory feedback, and scattered
   prior work are not noise around the writing — they are the hard part of
   the writing. Each concept's core move is turning one species of fog into a
   manipulable object (a criterion, a debt, a tideline, a pinned
   contradiction, a broken trace) without letting the machine resolve it.
2. **The AI's best verbs are not "write" or "fix."** Across all five, the
   verbs that survived sketching were: ask, quote, notice, gather, resurface,
   narrate, believe, doubt, fade. Every time a sketch drifted toward the AI
   producing prose, the concept got weaker and more generic.
3. **Judgment stays home.** Every concept has a moment where the tool could
   render a verdict and instead hands the writer a pen: the ●◐○ marks, the
   debt rewrite, the reflection box, the "noticed, not decided" tag, the
   one-line verdict. That refusal is the product.
