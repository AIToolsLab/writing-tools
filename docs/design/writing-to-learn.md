# Writing to Learn, and the Classroom

*A design exploration — what changes when the document is not the point.
July 2026*

> **Status:** exploration. Third in a series with
> [`interface-concepts.md`](interface-concepts.md),
> [`interaction-concepts.md`](interaction-concepts.md), and
> [`discernment-in-community.md`](discernment-in-community.md). That last one
> found that our designs assume **one writer**. This one finds that they assume
> **one document, and that the document is the point.** Both assumptions are
> load-bearing and both are wrong for the setting our lab actually sits in.

---

## 1. The second assumption

The community doc caught the first: nineteen concepts, one human in each. Here
is the second, and it hides better.

Every concept we have written takes a document as its object. The Charter
defines success *for a document*. Revise improves *a document*. The Table Read
rehearses *a document's* reception. Tidelines is the sole exception, and even it
treats documents as the substrate it observes. Our stated value —
**formation over output** — is expressed as a claim about the tool's posture
*toward output*. Output is still the thing we are posturing toward.

Writing-to-learn says something more radical than "care about the writer too."
It says that for a large and important class of writing, **the document is a
byproduct.** Janet Emig's "Writing as a Mode of Learning" (1977) makes the claim
that writing is not a report on thinking that has already happened; it is a mode
in which thinking happens, uniquely, because it is self-rhythmed, because it
makes thought visible and reviewable to its own author, and because the writer
gets feedback from their own product mid-process. Under that claim, a paragraph
that took forty minutes and got deleted was not wasted work. It was the work.

Our tool cannot represent that paragraph. It has no concept of writing that
isn't going anywhere. Ask the sidebar for help with a passage you intend to
throw away and it will earnestly try to make it good.

---

## 2. What writing-to-learn actually claims

Three ideas do the work, and the third names our problem precisely.

**2.1 Modes, not quality levels.** Britton's *Development of Writing Abilities
11–18* (1975) sorts writing into three functions: **transactional** (to inform,
persuade, transact with a reader), **poetic** (the verbal artifact), and
**expressive** — writing close to speech, exploratory, loosely organized,
addressed to the self or to a trusted reader who will not judge it. Britton's
claim is that expressive writing is the *seedbed*: the matrix out of which the
other two develop, and the mode in which a writer works out what they think.

Now read our design docs against that taxonomy. Draft, Revise, Chat, the
Charter, the Table Read, Who Is Served?, The Reader's Reply, Say-Back — every
single one is an instrument for transactional writing. Several of them
(the Charter's refusal to run without an audience; the brief's audience field)
make audience-orientation a *precondition of help*. In expressive mode that is
not merely useless, it is the wrong instruction: the whole point is to write
before you know who it's for, because knowing who it's for too early is what
stops you finding out what you think.

**We built an entire product on one of Britton's three modes and called it
writing.**

**2.2 Low stakes and high stakes.** Elbow's "High Stakes and Low Stakes in
Assigning and Responding to Writing" (1997) makes the operational version:
low-stakes writing is frequent, short, ungraded or lightly graded, and its
purpose is to make students think and to show the teacher what they're
thinking. High-stakes writing is the polished artifact. Elbow's argument is that
low-stakes writing is where students are willing to be wrong, and that being
willing to be wrong is a precondition of the high-stakes work getting good.

Our tool treats every session as high-stakes, because it always behaves as
though the document matters. There is no dial.

**2.3 The mechanism, and it is exact.** Bereiter & Scardamalia's *Psychology of
Written Composition* (1987) — already cited in our Loom concept, which is
a nice piece of luck — distinguishes **knowledge-telling** from
**knowledge-transforming**. Knowledge-telling: retrieve what you know about the
topic, write it down, stop when you run out. Knowledge-transforming: the
*content* problem space ("what do I actually believe, and is it true?") and the
*rhetorical* problem space ("how do I say this to this reader?") interact, and
each one changes the other. You reach for a way to phrase it, discover you
can't, and find out that you didn't believe the thing. Learning happens in the
traffic between the two spaces. Only there.

That gives us the mechanism of harm in one sentence, and it is sharper than
anything in the over-reliance literature:

> **Fluent generated prose solves the rhetorical problem without ever entering
> the content problem — so the traffic between the two spaces, which is where
> the learning is, never happens.**

This is what our own experiment already calls *premature closure*
(`experiment/docs/research-overview.md` §1.1: "the AI short-circuits the
thinking process itself"). Writing-to-learn supplies the theory of *which*
thinking, and *why* its absence is invisible: the document looks fine. It looks
better than fine. The rhetorical problem was solved beautifully. Nothing in the
artifact records that the content problem was never opened.

---

## 3. The classroom is not just a community with homework

The community doc treated the lab, the writing group, the newsroom as
interchangeable. A classroom differs on three axes that change the design, and I
got one of them wrong last time.

**3.1 The grade is the strongest force in the room, and it bends everything.**
Deci and Ryan's self-determination theory, and the long line of work on
extrinsic rewards crowding out intrinsic motivation, predict what every teacher
observes: whatever is graded becomes the object of effort, and whatever is
merely encouraged does not. The design consequence is brutal and general:

> **Anything the tool can log, a grading regime will eventually grade.**

Not because instructors are villains — because assessment is under real pressure
and a process log looks like exactly the evidence everyone has been asking for.
This flips the "guaranteed backstage" from the community doc's §6.3 from an
important guard into a structural requirement. In a classroom, a *policy* that
expressive writing won't be reviewed will lose to institutional need within two
semesters. The only durable guarantee is that the data does not exist.

**3.2 Ostrom does not survive the power asymmetry — my previous doc was wrong
about this.** I proposed community covenants governed by Ostrom's design
principles, including collective choice: those affected by the rules make the
rules. Ostrom's commons are roughly power-symmetric. A classroom is not. A
student cannot meaningfully dissent from a graded requirement, so a
"co-authored" classroom covenant risks being a compliance document that has been
made to look consensual — which is worse than an honestly imposed one, because
it launders the imposition through the student's own signature.

The governance model for a classroom is closer to **fiduciary duty** than to
commons self-governance: the instructor holds power on behalf of students'
formation and is accountable for it, and the tool's job is to make that
accountability legible rather than to stage a fake negotiation. Where genuine
student choice exists it should be real and low-stakes (which practices to try,
what to bring to review) rather than nominal and structural.

**3.3 The instructor is a user we have never once considered.** Every design doc
in this repo has a writer as its subject. But the highest-leverage intervention
in AI-and-writing pedagogy is not a student-facing feature at all — it is
**assignment design.** Bean's *Engaging Ideas* is built on the observation that
most writing assignments fail because they do not pose a genuine problem, and a
prompt with no real question is a prompt a language model can complete perfectly
and a student can learn nothing from. The pedagogically serious answer to "AI
does my homework" is not detection. It is homework worth doing.

Detection deserves one sentence so we can stop discussing it: automated AI
detectors are unreliable and are documented to be biased against non-native
English writers (Liang et al., *Patterns*, 2023), and our trajectory logs would
be extremely attractive to anyone who wanted to build one. We should decide now,
in writing, whether we will permit that use of them.

---

## 4. Design moves

### 4.1 The Seedbed — a mode where the tool's contribution is refusal

*Britton's expressive function; Elbow's freewriting; the backstage requirement.*

A writing surface for text that is not going to a reader. The sidebar goes dark.
No suggestions, no reader personas, no Charter, no audience field, no doctext
analysis. What remains: a prompt, a timer, a word count that goes up, and a
promise — **nothing here is logged, reviewed, or retrievable by anyone but
you.** Not a setting. A visibly different room.

This is the strangest thing in three design documents: a feature whose entire
content is an absence, in a product whose business is presence. I would defend
it as the most honest expression of "formation over output" we have available,
because it is the one place we stop asserting restraint and implement it. It is
also the only way the covenant's "silence is a feature" ever gets tested — right
now silence means "the AI waits to be asked," which is not the same thing at
all.

**What the AI does not do:** anything. That is the feature. The strong version
doesn't even have a model behind it.

**Cheapest test:** the Seedbed is a text box and a timer. Build it in an
afternoon, put it in Labs, and see whether anyone uses it twice.

### 4.2 The stakes dial

*Elbow's high/low stakes; document-scoped settings, which already ship.*

Make stakes an explicit property of a writing session, set by the writer (or by
a course covenant), that changes what the tool is. Low: Seedbed behavior,
quantity over quality, nothing retained. High: the full apparatus. Middle:
questions but no prose.

This is the cheapest structural fix in the document, because the mechanism
exists — `getDocumentSetting`/`setDocumentSetting`, the channel the brief already
rides. And it converts a problem we currently paper over into a first-class
choice: right now every session is implicitly high-stakes, and a writer who
wants to think badly on purpose has to fight the tool to do it.

### 4.3 Be most helpful where the writer is confused about the world

*Knowledge-telling vs. knowledge-transforming, turned into a policy.*

If the learning lives in the traffic between the content and rhetorical problem
spaces, then a tool's help should be allocated by *which space the writer is
stuck in* — and the allocation should be the opposite of the industry default:

> **Most helpful where the writer is confused about the world. Least helpful
> where they are confused about the sentence.**

Concretely: "I don't know whether this is even true" gets the tool's full
attention — sources, counter-cases, the reader who would object, our existing
Say-Back and Reader's Perspective machinery. "Make this paragraph flow better"
gets a question instead. Our Earn-the-Answer concept (#7) is already this
mechanic; what's new is the *criterion* for when to apply it, which until now was
"always," and "always" is a blunt instrument that will annoy people out of the
product.

**Risk, and it is real:** this stance has a cost that falls unevenly. For a
second-language writer, sentence-level fluency help may be exactly the scaffold
that gets them *into* the content problem space, where the learning is. The
distinction that keeps this honest is Bjork's: a **desirable difficulty** is
difficulty in the skill being learned; everything else — interface friction,
anxiety, a language barrier orthogonal to the learning goal — is just
difficulty. Which is which depends on the learning goal, which means this must
be set by the goal (or the course), never hard-coded as a universal virtue.
"Friction is good for learning" is one careless sentence away from an
accessibility failure.

### 4.4 Give the Charter to a class

*Sadler's evaluative expertise; rubric co-construction; boundary objects.*

Sadler's argument (1989, and the long line after it) is that the goal of
formative assessment is for students to develop the tacit knowledge of what good
work looks like — and that this cannot be transmitted, only built by making
judgments. Rubric co-construction is the most robust practical form of that.

Which means **the Charter is already a classroom feature and nobody noticed.**
Students draft criteria before writing; the class negotiates a shared version;
each student's personal Charter inherits from it and may dissent, with the
dissent recorded (the register from the community doc, which survives the
classroom fine even though Ostrom didn't). The ●◐○ marks are already
writer-set, which is already Sadler's point: the student grades against criteria
they helped build, and the AI's contribution is evidence.

Of everything across three documents, this is the highest value per unit of work
remaining, because most of it is built.

### 4.5 Peer review that keeps the learning with the reviewer

*Lundstrom & Baker (2009); Hattie & Timperley; Carless & Boud's feedback
literacy; the clearness committee.*

The finding that should govern every automated-feedback decision we make:
**giving feedback benefits the giver more than receiving it benefits the
receiver** (Lundstrom & Baker, *JSLW* 2009, and consistent replications). If
that holds, then:

> **Automating feedback takes the learning away from the student and gives it to
> the machine.**

The student who would have learned by reviewing now receives a review instead —
and receiving is the weaker half of the transaction. The instructor sees better
feedback and less learning, and the trade is invisible.

So the classroom version of the clearness committee inverts who the AI is
coaching. Students review each other; the AI's *student is the reviewer*. It
holds the question-only discipline, anchors comments to text, and teaches
feedback literacy in situ: *"that comment is about the writer, not the writing —
Hattie's four levels say the 'self' level is the one that reliably doesn't work.
Can you make it about the process?"* The AI never produces the feedback. It
produces better reviewers.

### 4.6 The muddiest point, and the variance

*Angelo & Cross's minute paper; the divergence map from the community doc.*

The classic low-stakes classroom instrument: two minutes at the end, "what was
the muddiest point?" Its problem at scale is that thirty responses are hard to
read, and its solution is the one thing we must not do — summarize them.

The divergence map transfers here without modification. Show the instructor the
*spread*, and surface the outlier response rather than burying it, because
Benedict's chapter 3 and Stasser's hidden-profile work agree that the lone
divergent read is carrying the information. A consensus summary of thirty
muddiest points tells the instructor what they already knew.

### 4.7 The theory-of-writing portfolio

*Yancey, Robertson & Taczak, "Teaching for Transfer" (2014).*

Transfer — the thing every writing course claims and few demonstrate — turns out
to depend on students building and revising an *articulated theory of writing*
they can carry to the next context. Not a reflection at the end; a theory,
stated early, revised against evidence from their own work all term.

That is Tidelines and the examen, scoped to a course, and it doubles as the
assessment artifact the AI-integrity panic is actually looking for: a claim about
your own process, evidenced by your own trajectory, which is hard to fake
convincingly and pointless to fake at all. It is also the place where the
trajectory logs earn their keep pedagogically rather than forensically — the
student uses their own record, and nobody else has to.

### 4.8 The instructor's assignment workbench

*Bean; genre as social action; the leverage argument.*

The one feature here aimed at a user we've never designed for. Help an
instructor turn "write five pages on the causes of the war" into a question with
a genuine problem in it — and, having done so, decide which Britton mode it
lives in, what stakes it carries, and which of the tool's capabilities are on for
it. The output is the course covenant from the community doc, but authored where
the actual design power sits.

I'd rank this second only to §4.4 in expected value, and it is the least
glamorous idea in three documents.

---

## 5. Where this pushes against us

**5.1 Our headline KPI has a hole in it, in the other direction now.** The
community doc argued "improve your unaided work" is individualist. Writing-to-
learn adds that it is also *document-scoped*: it measures unaided writing
performance, when the thing at risk is the learning the writing existed to
produce. A student can end a term writing better and having learned less about
the subject, and our instrument cannot see it. **Document quality and learning
can move in opposite directions, and only one of them is visible.**

**5.2 Student satisfaction is actively misleading here, and we can prove it.**
Bjork's work on metacognitive illusions is unambiguous: conditions that produce
fluency during acquisition feel like effective learning and produce worse
retention and transfer, and learners cannot detect this by introspection. AI
assistance is a fluency machine. The strong prediction — testable in our own
experiment app — is that participants will *rate AI-assisted sessions as better
learning experiences while performing worse on delayed transfer measures.* If
that dissociation holds, it is the most useful thing this lab could publish, and
it indicts the entire industry's primary metric.

**5.3 One tool, one classroom, twenty expertise levels.** The expertise reversal
effect (Kalyuga) says scaffolding that helps a novice actively harms an expert.
There is no setting of our features that is right for a whole class. This makes
Tidelines' fading mechanic not a nice developmental touch but a structural
necessity, and it means any course-level covenant is a compromise that will be
wrong for the students at both tails.

**5.4 "Silence is a feature" was never tested.** Our covenant's silence means the
AI waits to be asked. Britton's expressive mode requires a stronger silence: the
AI is not there. Until the Seedbed exists, the principle is a manner, not a
commitment.

**5.5 The deepest one: the object of the activity is not the document.** Russell
and the activity-theory line make the point that a writing classroom is a strange
system, because its object is the student's development and the document is
merely the instrument. Our entire design space inverts that. Put the two
critiques together and the shape is clean:

> The community doc found we assume **one writer**.
> This one finds we assume **the document is the point**.
> A classroom is the setting where both assumptions fail at once — which makes
> it the sharpest available test of whether "formation over output" is a value
> or a slogan.

---

## 6. What this would touch in the code

**6.1 The stakes dial is a document setting, and that channel already works.**
`EditorAPI.getDocumentSetting`/`setDocumentSetting` plus `docBriefContext` is the
existing pattern (see `frontend/CLAUDE.md`). Stakes belongs beside the brief's
audience/purpose/constraints — and it satisfies that section's own rule, since a
human collaborator would absolutely want to know whether this draft is a
throwaway.

**6.2 The Seedbed needs a logging bypass, not a consent level.** This is a
different requirement from anything in `frontend/src/consent.ts`. Consent levels
strip payloads; the Seedbed needs sessions that never generate a payload at all,
and needs that to be architecturally true rather than configured — because §3.1
says a policy will not hold. A "no events emitted from this page, enforced at
`useLog`" boundary is a small piece of work with a large guarantee attached.

**6.3 Stakes and mode should gate the page registry, not just prompts.**
`frontend/src/pages/registry.tsx` already gates pages by tier and an `enabled`
predicate; a course covenant that turns Draft's generative modes off for an
assignment is that mechanism with a server-side subject — the same conclusion the
community doc reached from a different direction, which is mild evidence it's
right.

**6.4 The experiment app measures the wrong dependent variable for this
question.** `experiment/docs/research-overview.md` measures information-seeking
and email quality — good instruments for premature closure, and premature closure
is the right construct. What's missing for the WTL claim is a **delayed** measure
with **no tool present**: transfer, not performance. That is a study-design note
rather than a code note, but it's the difference between measuring what the AI
did to the email and what it did to the writer.

---

## 7. Principles

Adding to the four from the community doc:

5. **Not all writing is going to a reader, and the tool currently cannot tell.**
   Britton's expressive mode is where learning happens and it is the one mode we
   have no surface for. Audience-orientation as a precondition of help is a
   correct policy for two of three modes and an error for the third.

6. **Be most helpful about the world, least helpful about the sentence** — with
   the allocation set by the learning goal, never universal, because the same
   friction that is desirable difficulty for one writer is an access barrier for
   another.

7. **Whoever gives the feedback is doing the learning.** This governs every
   automation decision in a classroom. An AI that reviews student writing has
   taken the more valuable half of the exchange and handed back the lesser one.

8. **Anything the tool can log, a grading regime will eventually grade.** Design
   for that, structurally, or the expressive writing dies first and quietly.
