# Discernment in Community

*A design exploration — what changes when the writer is not alone. July 2026*

> **Status:** exploration, arguing with our own prior work. Companion to
> [`interface-concepts.md`](interface-concepts.md) (the five surfaces) and
> [`interaction-concepts.md`](interaction-concepts.md) (the fourteen concepts).
> Nothing here is specced for implementation, except §7, which names things
> already broken or missing in the code.
>
> Continued in [`writing-to-learn.md`](writing-to-learn.md), which finds the
> second buried assumption — that the document is the point — and corrects §4.4
> below: Ostrom's governance model does not survive a classroom's power
> asymmetry.

---

## 1. The assumption nobody wrote down

Read our two design documents back to back and a pattern shows up that neither
of them states. Every one of the nineteen concepts has exactly one human in it.

The Charter is negotiated between a writer and a machine. The Prior Self
indexes one person's corpus. Tidelines coaches one person for six months. The
Loom holds one person's threads. The Table Read stages a room full of readers,
all of whom are simulations. The Post-Game Review reports to the writer alone.
The Dojo trains one athlete. Inkwell discloses provenance to no one in
particular.

Even the vocabulary gave it away. The word *collaborative* appears throughout
`my-words-voice-native-research.md` and it never once means "with another
person" — it means "the AI takes smaller turns." We built a theory of
partnership in which the only available partner is a language model.

This is not an oversight so much as an inheritance. Composition studies has a
name for it: the myth of the solitary author, which Lunsford and Ede spent a
book dismantling (*Singular Texts/Plural Authors*, 1990) by pointing out that
most writing that matters in the world — proposals, reports, articles, policy,
liturgy, code — is produced, reviewed, and owned plurally, while our images of
writing remain stubbornly Romantic. Word processors are built for the myth.
Sidebars are built for the myth. We built for the myth.

The cost is specific, and it is worth stating in our own terms. Our anchor
value is that *AI use should improve your unaided work*. Under the solitary
assumption, "unaided" means "without the machine." But no serious writer has
ever been unaided in the stronger sense. They had an advisor, a writing group,
an editor, a colleague two doors down, a tradition of texts they were
answering. When a tool inserts itself between the writer and the blank page, it
is not only competing with the writer's own thought. It is competing with the
writer's *people* — and it wins, because it is available at 11pm and never
tired and never disappointed in you. That substitution is invisible in every
metric we have proposed, because every metric we have proposed has one subject.

**The question this document asks:** if discernment in community is a real
value and not a decoration, what does it demand of the design? The answer turns
out to be more interesting than "add sharing features." Three of our existing
concepts get *better* when a second person enters. Two of them get *dangerous*.
And one of our stated values quietly changes meaning.

---

## 2. What the traditions of communal discernment actually specify

"Discernment in community" can degrade into a mood — warmth, consensus,
belonging. The traditions that practice it seriously are not warm; they are
*procedural*. Each one is a set of constraints on how a group is allowed to
think together, and every constraint has a direct design analogue.

**The Quaker clearness committee.** A person facing a decision convenes a small
group. The committee's single rule is the interesting one: *members may ask
questions only.* No advice, no anecdotes, no "what I would do." The discipline
exists because advice returns the decision to the advisor, and the point is to
help the focus person hear their own life. A clerk records; the group seeks the
sense of the meeting rather than a vote.

We have, without noticing, already written the clearness committee's rule into
our covenant. "The AI's best verbs are not *write* or *fix*" — ask, quote,
notice, gather, resurface, narrate. "Judgment stays home." Our machine is
already trying to behave like a clearness committee of one. The obvious move is
to notice that a *real* clearness committee is made of people, and that the
machine's best role in it is the one job nobody wants: **clerk**. Scheduling,
holding the question-only discipline when someone drifts into advice,
recording, drafting the minute the group then approves aloud.

**The Genevan practice, since this lab sits where it sits.** Calvin's Company
of Pastors met weekly for the *congrégation* — one minister expounded a text
while the others critiqued it, in front of the public — and quarterly for the
*censura morum*, a mutual examination in which each pastor submitted his life
and practice to the criticism of peers before communion. Two features are worth
stealing. It was *mutual*: the critic this quarter is the criticized next
quarter. And it was *scheduled*: it happened on the calendar, not when someone
felt bad enough to ask. A review practice that only fires when a writer feels
guilty selects for the wrong writers.

**Benedict.** *The Rule*, chapter 3: the abbot calls the whole community to
counsel, including the youngest, "because the Lord often reveals what is better
to the younger." This is a design constraint about aggregation. A discernment
surface that averages its members will systematically lose the novice's read —
and the novice's read is the one that tells you the document is unreadable to a
newcomer. Weight the margin, don't average the room.

**Ignatian communal discernment.** Rounds in which each person speaks without
rebuttal before anyone responds; a period of deliberate indifference to one's
own preferred outcome; attention to consolation and desolation as data. The
mechanic that matters here is *no rebuttal in round one*. It is a protocol
against the loudest person setting the frame.

**Bonhoeffer.** *Life Together*: "the first service one owes to others in the
fellowship consists in listening to them," and the warning that the community
you *wish* for is the enemy of the one you actually have. Applied to us: a
feature that simulates the ideal reader is a wish dream. The rushed, distracted,
partly-hostile actual colleague is the community.

**And the counter-tradition, which the design needs more than the tradition.**
Kierkegaard: the crowd is untruth. Communal discernment fails in known,
repeatable ways, and the empirical literature names them precisely — group
polarization (Sunstein), and the hidden-profile effect (Stasser & Titus, 1985),
in which groups spend their discussion on information everyone already shares
and never surface the unique thing one member knows. That failure is *exactly*
what an LLM does by construction: it returns the modal reading. A community
surface built on a model that outputs consensus, applied to a group that drifts
toward consensus, produces the most confident possible wrongness.

This yields the hardest constraint in the document, and it is worth putting in
the covenant:

> **The AI may convene, hold discipline, record, and route. It may never speak
> for the group, and it may never report a consensus it computed.** Where a
> synthesis is needed, the AI drafts it as a minute — provisional, attributed,
> inert — and the group has to say yes out loud.

---

## 3. The theory that makes it buildable

The traditions give the ethics. Five bodies of HCI and social theory give the
mechanisms, and one of them names our gap so exactly it is almost rude.

**Activity theory (Engeström).** The activity triangle has six nodes: subject,
object, instruments — and *community*, *rules*, *division of labor*. Our
nineteen concepts populate the first three with real care and leave the second
three empty. That is the whole diagnosis in one diagram. "Who else is in this
activity, what norms govern it, and who does which part" are not features we
forgot; they are a third of the model.

**Social translucence (Erickson & Kellogg, 2000).** Systems should make socially
salient information visible enough that people can use their ordinary social
intelligence. Their canonical image is the frosted-glass door: you can see that
someone is on the other side, and that they are moving, so you don't slam it
into them — but you cannot see who they are or what they are doing.
*Translucent, not transparent.* This is precisely the right calibration for the
sharing question, and it rules out the version of provenance-disclosure that
everyone reaches for first. Their three requirements — visibility, awareness,
accountability — are a usable checklist.

**Contextual integrity (Nissenbaum).** Information flows are appropriate or not
relative to the norms of the context they occur in; there is no context-free
"private" or "public." This is the theory that makes *sharing-aware AI* cut both
ways, which is the thing our first instinct gets wrong. If a document is
co-authored, the naive move is "give the AI more context — it should know about
the collaborators." The contextual-integrity move is the opposite: **a
co-authored document is a context in which the AI must do less.** My Prior Self
atlas surfacing an excerpt from my private 2023 memo, in a sidebar my
co-author's screen share is broadcasting, is a leak I never authorized and the
tool arranged.

**Distributed cognition (Hutchins) and transactive memory (Wegner).** Cognitive
capability is a property of a system of people and artifacts, not of a skull.
Hutchins's navigation team knows how to fix a position; no member does. Wegner's
couples remember more together because each maintains a directory of *who knows
what*. Two consequences for us. First, our KPI is individualist in a way we
should at least argue about (§6). Second, transactive memory hands us the single
best design move in this document: the Prior Self's most valuable card is
sometimes **not a passage but a person**.

**Grudin's groupware challenges (1994).** Groupware fails when the person who
does the extra work is not the person who gets the benefit. This is the
guillotine under every idea below. Provenance disclosure benefits readers,
reviewers, and institutions; the work falls on the writer. Community memory
benefits the newcomer; the work falls on the veteran. Any feature here that
does not pay its author back *within the session* is already dead, and our own
Loom notes said as much for the solo case.

Three more, briefly, because each generates a concrete move:

- **Boundary objects (Star & Griesemer).** Artifacts plastic enough to mean
  different things locally, robust enough to hold identity across groups. The
  Charter is one criterion-edit away from being a real boundary object between
  a writer and an advisor.
- **Legitimate peripheral participation (Lave & Wenger).** Novices learn by
  watching competent practice from the edge. Nobody has ever watched anybody
  write. This is the affirmative argument for the trajectory logs, and it is
  much stronger than the audit argument.
- **Genre as social action (Miller) and discourse communities (Swales).**
  Norms for AI use are genre-specific and community-specific, not universal. A
  tool that offers the same eight buttons for a grant proposal, a pastoral
  email, a peer review, and a freshman essay is asserting that these are the
  same act. They are not, and the community — not the vendor — is the body with
  standing to say so.

And one debt we should have paid already: **Peter Elbow's teacherless writing
class** (*Writing Without Teachers*, 1973) is a group of seven to twelve people
who meet weekly and give each other "movies of the reader's mind." Our Table
Read is a machine reconstruction of that class. We took the one practice in the
literature whose entire thesis is *you do not need an expert, you need each
other*, and we replaced the each-other with personas. That is either the
cleverest or the most self-defeating thing in the design space, and which one it
is depends on whether the simulation increases or decreases the number of times
a real person reads the draft.

---

## 4. Eight design moves

Each is stated as: what it is, which existing concept it modifies, what the AI
pointedly does *not* do, the risk, and the cheapest honest test.

### 4.1 Footing — the sidebar knows who else is in the room

*Modifies: everything. Theory: contextual integrity, Goffman's participation
framework, social translucence.*

The add-in reads the document's actual sharing state — co-authors present,
permission scope, whether this file is shared with a named person, a team, or
the world — and lets that state change its behavior. Goffman's vocabulary is
better than "author" here: a document has an **animator** (who typed it), an
**author** (who composed the words), and a **principal** (whose commitments the
text expresses). AI writing scrambles these, and "was AI used?" is the wrong
question because it collapses all three.

What changes with a second name on the document:

- **Restraint first.** Private-corpus retrieval (Prior Self) goes quiet, or asks
  before surfacing anything from outside this document's sharing context.
  Cross-document coaching observations (Tidelines) never render while a co-author
  may be looking.
- **Then affordance.** New questions become askable that are nonsense alone:
  *who is writing which part?* *Where do you two disagree and has either of you
  said so in the text?* Division of labor is a first-class thing to notice.
- **Then translucence.** A frosted-glass indicator — the sidebar is in use on
  this document — coarse by design, reciprocal by construction. Not *what* was
  generated. Not *how much*. Presence only, the way a cursor tells you someone
  is in the file.

**The AI does not:** report your activity to your co-authors in any granularity
finer than presence, or make a disclosure on your behalf.

**Risk:** presence indicators become pressure. Someone will read "sidebar in
use" as "not really their work," which is exactly the inference the coarse
signal is meant to prevent and will not always prevent. Reciprocity is
load-bearing: if you can see mine, I can see yours, and if you opt out you also
opt out of seeing.

**Cheapest test:** instrument nothing. Ask ten people who co-author regularly
what they'd want a collaborator to know about their AI use, and — separately,
first — what they'd want to know about a collaborator's. The gap between the two
answers is the finding, and I would bet real money it's large.

### 4.2 The Clearness Committee — the Table Read with the humans put back

*Modifies: Concept 5 (Table Read), Concept 1 (Charter). Theory: Quaker practice,
Elbow's teacherless class, Grudin.*

The Table Read simulates readers because real readers are expensive. Attack the
expense instead of the reader.

A writer requests a clearness reading: three colleagues, twenty minutes each,
asynchronous, within a week. Each gets the draft and one instruction — **you may
ask questions only.** No advice, no line edits, no "have you considered." The
AI's role is the clerk's, entirely: it composes the ask so it is small and
answerable, it holds the discipline (when a reader types "I'd move paragraph
three," it offers back "what's the question underneath that?"), it collects, it
anchors each question to the text with the doctext links Revise already has, and
it drafts a minute the writer edits and keeps.

The believing pass and the doubting pass survive intact from the Table Read, and
the order is still non-configurable — but now Act I is a real human trying to
restate your argument at its strongest, which is a completely different artifact
from a model doing it, because when a real person can't restate your argument,
that is *news*.

**The AI does not:** answer any of the questions. Rank them. Summarize the three
readers into one reader. Or read the draft in the readers' place when a reader
doesn't show up.

**Risk:** it dies on logistics, like every writing group in history. Which is
also the opportunity — logistics is articulation work, and articulation work is
the thing software is genuinely good at and communities are genuinely bad at.
If this works it works because the ask got small enough to say yes to.

**Cheapest test:** run it by hand, no code, four writers in the lab, three
rounds. Measure one thing: does the question-only rule hold without enforcement,
and if not, where does it break?

### 4.3 Predict-the-Readers — commit before reveal, as a group ritual

*Modifies: Concept 4 (Predict-the-Reader). Theory: hidden-profile effect,
Delphi, group polarization.*

Our best existing mechanic is commit-then-reveal: the writer guesses three
reader questions before the AI shows its list, and the overlap is scored over
time. That mechanic scales to groups without modification, and at group scale it
is doing something more important than calibration — it is *protecting
independent judgment before aggregation*, which is the single defense against
the failure modes in §2.

Everyone in the reading group — co-authors, reviewers, a committee — records
their own read privately. Nobody sees anyone else's until everyone has
submitted. Then all reads reveal at once, anchored to the same paragraphs.

The artifact is the **divergence map**, and the design slogan is:

> **The AI's contribution is the variance, not the mean.**

Where four readers converge, the text is doing one thing. Where they scatter,
the text is doing four things, and the writer didn't know. Divergence is the
signal; consensus is comparatively worthless, and it is exactly what an
LLM-summarized "here's what your reviewers said" would have destroyed.

**The AI does not:** aggregate, average, rank, or resolve. It aligns independent
reads to common anchors and displays the spread. Where two readers contradict,
it pins them side by side — the single best frame in the Loom storyboard,
promoted from feedback-management to the core mechanic.

**Risk:** the private-commit step is friction, and friction is where rituals die.
It has to cost under three minutes.

**Cheapest test:** it is already a condition in the experiment paradigm.
Individual Predict-the-Reader is specced; group Predict-the-Readers is the same
instrument with N participants and one extra field. Divergence among readers is
a clean, publishable dependent measure.

### 4.4 The examen, and the rule of life

*Modifies: Concept 6 (Post-Game Review), Concept 3 (Tidelines). Theory: Ignatian
examen, censura morum, Ostrom.*

This is the second of the two intuitions that prompted this document — logging
your own trajectory for later reflection — and it splits cleanly into a personal
half we can build now and a communal half that needs governance before it needs
code.

**Personal (the examen).** Weekly, five minutes, from the logs we already write
in `backend/src/logging.ts`. Questions, never scores, and never a dashboard: *Where
this week did you accept something you didn't understand? Which suggestion are
you still not sure was yours? What did you stop trying to do yourself?* The
Ignatian examen is a review of consolation and desolation, not a productivity
audit, and the tone difference is the entire feature.

**Communal (the rule of life).** A lab, a class, a newsroom, a writing group
covenants together about what AI use is fitting for the kind of writing they do,
and then reviews the practice together on a schedule. Ostrom's design principles
are the governance spec, near-verbatim: those affected by the rules make the
rules; monitors are accountable to the monitored; responses are graduated and
start absurdly low; there is a real conflict-resolution path; and boundaries are
explicit.

Four guards, all non-negotiable, and each corresponds to a way this becomes
surveillance:

1. **The logs are the writer's.** The community sees what the writer brings.
   This is closer to confession than to telemetry, and the difference is
   who initiates.
2. **Reciprocity.** Whoever reviews is also reviewed. The Genevan pastors put
   this in the constitution, not the culture.
3. **Formative questions only.** "Where did you outsource the thinking you most
   needed to do?" is a discernment question. "Did you exceed your AI budget?" is
   a compliance question with a discernment costume on.
4. **A guaranteed backstage.** See §6.3. Non-negotiable, and the reason this
   section is the most dangerous idea in the document.

**The AI does not:** initiate disclosure, compute an adherence score, notify
anyone of anything, or retain review artifacts past the session that produced
them.

**Where this breaks:** Ostrom's principles assume roughly symmetric power among
commoners. A classroom does not have that, and a student cannot dissent from a
graded requirement without cost — see `writing-to-learn.md` §3.2, which replaces
this governance model with fiduciary duty for the classroom case.

**Cheapest test:** the covenant without the software. Have the lab write its own
one-page rule of life for AI use in writing, and hold one review meeting where
people bring what they choose. If that meeting is worth having, build toward it.
If it isn't, no feature would have saved it.

### 4.5 The AI's best answer is a person's name

*Modifies: Concept 2 (Prior Self). Theory: transactive memory, Illich's
peer-matching.*

Prior Self is a memex for one person. Extend the atlas across a community — with
per-item, revocable, opt-in contribution — and the librarian gains a new highest
move. Not an excerpt. A referral:

```
┌──────────────────────────────────────────┐
│  Your ¶7 argues the accreditation case    │
│  from enrollment data.                    │
│                                           │
│  Marcus argued the opposite in the 2024   │
│  self-study, §3 — and he's still here.    │
│                                           │
│  [read his §3]  [ask him]  [dismiss]      │
│                                           │
│  I'm not going to summarize his argument  │
│  for you. He'd rather tell you himself.   │
└──────────────────────────────────────────┘
```

This adds a verb to the list our own sketching produced — ask, quote, notice,
gather, resurface, narrate, believe, doubt, fade — and it is the one that turns
the tool outward: **refer**. It also implies a matching refusal, which is the
part I'd defend hardest: *the AI declines to answer when a person should.*

A tool whose most valuable output is "go talk to Marcus" is a tool that builds
community rather than substituting for it. It is also, bluntly, the only feature
in this document that a language model is uniquely positioned to provide,
because finding the one person in a 200-person institution who has already
thought about your problem is a retrieval task no human directory solves.

**Risk:** extraction, in two directions. It mines colleagues' corpora, and then
it spends colleagues' time. Consent per source, reciprocity in the directory
(you appear in referrals only if you participate), and a visible cost to
referring — you are spending someone's attention, and the interface should say
so.

**Cheapest test:** the Slack question that starts "does anyone know if we've
already written about—". Count how often it's asked in a month and how often it
gets a useful answer. That is the baseline the feature has to beat.

### 4.6 The Chronicle — process made watchable

*Modifies: Concept 6, Concept 3. Theory: legitimate peripheral participation.*

The artifact nobody has is not the finished document; it is somebody competent
being confused in public. Experienced writers opt to publish an annotated replay
of one real document's evolution — the false starts, the paragraph that survived
eleven revisions, the section deleted in week three, the AI suggestion taken and
the AI suggestion refused, with a sentence about why.

Tidelines already says *your own best work is the exemplar*. The community
version: **your community's best work-in-process is the exemplar.** For a
graduate student, watching an advisor's actual drafting mess is worth more than
any amount of finished prose, and it is the single thing apprenticeship provides
that our tools have never even attempted.

**The AI does not:** publish anything automatically, narrate the writer's process
for them, or generate the annotations. The annotations are the value and they
are the writer's.

**Risk:** it costs the veteran and pays the newcomer. Grudin's law, cleanly
stated. The only honest answer is that the annotation pass has to be worth doing
for the veteran too — which it plausibly is, since explaining your process is
how you find out what it was.

### 4.7 Covenant as configuration

*Modifies: the Charter, and `flags.ts` / the tool launcher. Theory: genre as
social action, Ostrom's collective choice.*

Make the community's norms a first-class artifact the software actually reads: a
machine-readable covenant, authored *in* the app by the community, that
provisions which tools appear for which genres. In a class where the point of
the assignment is to learn to structure an argument, the Charter is on and Draft's
generative modes are off — because the class decided that, visibly, with a date
and an amendment history, not because a vendor shipped a "student mode."

Two structural features carried over from the Charter: a `history ▾` so norms
are visibly renegotiable rather than handed down, and a **dissent register** that
records the minority position instead of erasing it. A covenant that shows its
own unresolved argument is Benedict's chapter 3 in a data structure — and it is
the specific defense against Kierkegaard's objection.

The plumbing partly exists. `docs/tool-launcher-plan.md` already contemplates
per-tool grants and scopes, and `frontend/src/pages/flags.ts` is explicit that
real per-user gating belongs server-side next to `isAllowed` in
`backend/src/auth.ts`. A covenant is that mechanism with a community as the
subject instead of a user.

**Risk:** this is the feature that becomes a compliance product if we're
careless, and there is a large market rewarding exactly that carelessness. The
distinguishing test is whether the community can amend it in under five minutes
without asking us.

### 4.8 The tradition as a member of the community

*Modifies: Concept 2. Theory: MacIntyre, Chesterton's "democracy of the dead."*

The community of discernment includes people who are dead and people who have
left. MacIntyre's tradition is "an historically extended, socially embodied
argument," and a lab that has written forty grant proposals has a tradition
whether or not it knows it. The Prior Self, pointed at institutional rather than
personal memory, is how a newcomer joins an argument already in progress instead
of starting one: *here is how this department has argued for its programs since
2011, including the two times it lost.*

This is the least urgent and most quietly important idea here. It is also the
one that makes the citation practices of scholarship legible as what they are —
a technology for being accountable to people you will never meet.

---

## 5. Where these sit against what we already built

| Existing | Under discernment-in-community | Verdict |
|---|---|---|
| The brief (audience/purpose, shipped) | Already document-scoped and inherited by the next reader | **Latent** — the second person is present and unaddressed (§7.0) |
| Charter (goal negotiation) | Boundary object co-held with advisor/committee | **Improves** — a rubric only you agreed to is a diary |
| Prior Self (personal atlas) | Community atlas; best card is a *person* | **Improves**, with real consent cost |
| Tidelines (solo coach, months) | Cohort practice; peer exemplars; shared focus skill | **Improves** — deliberate practice is social everywhere else |
| Loom (threads, layers) | Layers are *already* other people's feedback | **Latent** — it's the closest to multiplayer and doesn't know it |
| Table Read (simulated panel) | Replaced by, or gated behind, a real reading | **Endangered** — see §6.4 |
| Post-Game Review (private log) | Examen + communal rule of life | **Improves, dangerously** — needs §4.4's four guards |
| Inkwell (per-character provenance) | In a shared doc, becomes an instrument of dispute | **Endangered** — see §6.5 |
| The Dojo (no-AI days, unaided KPI) | Whose capability are we measuring? | **Contested** — see §6.1 |

---

## 6. Where this pushes against us

The invitation was to push. Five places where taking community seriously costs
us something we've already written down.

### 6.1 "AI use should improve your unaided work" is an individualist metric

It is our second anchor value and it assumes the skull is the unit of
capability. Distributed cognition says otherwise: Hutchins's navigation team is
more capable than any navigator on it, and no one calls that team over-reliant.
If reliance on people is fine and reliance on machines is not, we owe an account
of the difference — and I think there is a good one, but we have not written it.

My candidate: the difference is **reciprocity and formation**. Depending on
Marcus makes Marcus's knowledge available *and* obliges you to Marcus, who will
depend on you next month, and the relationship forms both of you. Depending on a
model creates no obligation, forms nobody, and leaves nothing behind when it is
switched off. That is a real asymmetry and it survives scrutiny — but note what
it implies for our KPI. The success metric is not only "how well you write
without the tool." It is also **whether the tool left a community more capable
of forming writers than it found it.** Those can come apart: a tool could improve
every individual's unaided prose while quietly ending the practice of anyone
reading anyone else's draft, and by our current dashboard that reads as total
success.

### 6.2 "Silence is a feature" collides with awareness

Weiser's calm technology gave us covenant point 4, and community features are
made of exactly the thing calm computing exists to prevent: noticing other
people. Every awareness indicator is an interruption with good manners.

The reconciliation I'd defend: awareness of *artifacts* may be ambient;
awareness of *people* must be pull, never push. The presence of a colleague's
question in your draft can wait for you to look. It may never buzz.

### 6.3 A community surface without a backstage will destroy the drafting

This is the one I am most confident about. Goffman's front stage and back stage
are not a nicety — the reason Elbow's freewriting works is that the writer has
somewhere to be bad. Every practice in §2 assumes a protected interior:
clearness committees are confidential, the examen is between you and God, the
censura morum happened behind a closed door.

If writing becomes observable — logged, reviewable, publishable, presence-
indicated — writers will optimize the observable. They will stop the exploratory
mess that produces good work, because the mess is now evidence. **Any feature in
§4 must ship with a guaranteed unobserved room**: a drafting space that is
never logged, never presence-indicated, never reviewable, and visibly so. Not a
setting. A room, with a door, that the writer can see is closed.

### 6.4 Simulated community may be a substitute good, and we can measure it

The Table Read is the sharpest case. If the simulated dean is *good enough*,
writers will stop asking the real dean — and the tool will have removed a human
encounter from the world while scoring well on every metric we have. The
believing pass is genuinely better performed by a person, because the
information content of "a real colleague could not restate your argument" is
categorically higher than a model producing the same sentence.

This gives an evaluative heuristic worth adopting across the whole product,
alongside unaided performance:

> **Human encounters per document.** Does this feature increase or decrease the
> number of times a real person engages this draft?

Rehearsal before a real reading is a legitimate use of a simulation — you
rehearse *because* the performance is real. Rehearsal *instead of* the reading is
the failure. Design the Table Read so the natural next click is scheduling one.

### 6.5 Provenance among peers is not provenance to yourself

Inkwell's per-character honesty heatmap is a fine instrument for self-knowledge
and a terrible one for a shared document, because in a shared document it will
be used in disputes — by a co-author assigning credit, an instructor assigning
blame, a reviewer assigning suspicion. Fine-grained provenance in a social
context is not translucence; it is transparency, which Erickson & Kellogg
specifically warned is not the goal.

The communal form has to be a *declaration of footing*, in Goffman's sense,
authored by the writer, shaped by the community's covenant, coarse by design,
and reciprocal. "I drafted this from my own notes; the AI questioned the
structure; §4 is Marcus's, rewritten" is a disclosure a human made and can be
held to. A heatmap is a forensic artifact nobody consented to.

---

## 7. What this would touch in the code today

Four things, in order of how real they are.

**7.0 The cheapest multiplayer surface is already shipped, and we didn't notice.**
`EditorAPI`'s `getDocumentSetting`/`setDocumentSetting` store values that belong
to the *document* rather than the user, and — the operative phrase from
`frontend/CLAUDE.md` — they "follow the file to whoever opens it next." The
writer's brief (`contexts/docBriefContext.tsx`) already rides that channel:
audience, purpose, constraints, authored by one person and read by the next
person to open the file. That is a boundary object in the Star & Griesemer sense,
in production, today, with no backend work required.

Its design rule is the tell. `frontend/CLAUDE.md` says a brief field is a fact
about the rhetorical situation, never an instruction to the model, and: **"Add a
field only if a human collaborator would want to know it too."** We were already
using an imagined colleague as the arbiter of what belongs in the document's
shared state. The brief is where §4.1 and §4.7 should start — not because it is
ambitious, but because it is the one place where the second person is already
implicitly present and merely unaddressed.

**7.1 The consent ladder has one axis and needs at least two.**
`frontend/src/consent.ts:11-16` models consent as depth of content — `none`,
`usage`, `ai_output`, `document`. Every question in this document is about a
second axis it does not have: **audience**. Who may see this, at what
aggregation, for how long, and can I revoke it? "Log my document text for the
study" and "show my revision trajectory to my writing group" are different grants
and today they are the same level.

**7.2 A co-authored document has more than one data subject, and the consent
model has one.** This is not a design musing; it is a live gap. If I set consent
to `document` and open a file I co-author, `docContext` goes to the backend
carrying my collaborator's sentences, and my collaborator never agreed to
anything. Same for chat `message` payloads quoting a shared draft. I don't know
the study protocol well enough to say whether this is an IRB problem, but
somebody who does know should look, because the code can't currently express
"this text is not only mine." Worth filing regardless of whether any feature in
this document gets built.

**7.3 Rooms already exist as a primitive and are pointed the wrong way.**
`docs/tool-launcher-plan.md` §v2 specs rooms anchored on a document-in-progress,
with a doc authority and arbitrary members over WebSocket — built for one user's
several devices, with "eventually collaborators" in a parenthesis. Every idea in
§4 that needs live multi-party awareness is that primitive with the membership
rule relaxed from *one user's surfaces* to *a document's people*. The switchboard
design (no server-side document state, no OT/CRDT) holds fine, because none of
these features move text.

**7.4 The covenant needs a server-side home.** `flags.ts` says out loud that it
is not access control and that per-user targeting belongs next to `isAllowed` in
`backend/src/auth.ts`. A community covenant is the same shape with a group as
the subject. Nothing needs building yet; it means the eventual answer isn't a
localStorage flag.

---

## 8. Research implications

The unit of analysis changes, and that is the publishable part. Nearly all
AI-writing research measures individuals; the questions above are dyadic and
group-level, and the experiment app already has the logging spine for it.

- **Divergence among independent reads** (§4.3) as a dependent measure — with
  the strong hypothesis that AI-assisted drafts show *lower* reader divergence,
  i.e. they read the same way to everyone because they're generically written,
  and that this looks like clarity while being flatness.
- **Human encounters per document** (§6.4) as a cross-cutting metric, and the
  substitution question: does access to a simulated panel reduce real
  consultation? Straightforwardly testable, and it's the study I'd most want to
  see run.
- **Referral acceptance** (§4.5): when the tool says "go ask Marcus," do they?
- **Covenant amendment history** (§4.7) as a naturalistic record of a community
  actually deliberating about AI — a rare artifact.
- **The Chronicle** (§4.6) as an intervention: do novices with access to
  veterans' annotated process revise differently?

---

## 9. Principles that emerged

Mirroring the three that closed `interface-concepts.md`:

1. **Sharing awareness first produces restraint, then affordance.** The instinct
   is that a shared document lets the AI do more. Contextual integrity says the
   first correct response to "someone else is here" is for the tool to do less,
   more carefully. Every feature in §4.1 that adds capability is downstream of
   one that removes it.

2. **The AI convenes; it does not speak for the group.** It may clerk, hold
   discipline, anchor, record, route, and refer. The moment it reports what "the
   group thinks," it has replaced the discernment with a summary of the
   discernment — and because it returns the modal reading, the thing it erases
   is exactly the minority voice both Benedict and Stasser tell us is carrying
   the information.

3. **A tool that says "go ask a person" is doing its best work.** The verb
   *refer* belongs in the covenant next to ask, notice, and fade, along with its
   refusal: decline to answer when a person should. This is the only line in the
   document that would show up on the invoice as a cost, which is roughly how
   you know it's the real commitment.

4. **Community needs a backstage or it eats the drafting.** Observability is
   corrosive to exploratory writing. A guaranteed unobserved room is a
   precondition for every other idea here, not a preference toggle.
