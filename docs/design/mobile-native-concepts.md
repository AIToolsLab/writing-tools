# Mobile-Native Interfaces for Thoughtful

*Design sketches — August 2026*

> Companion to [`interface-concepts.md`](./interface-concepts.md) (the five
> long-horizon concepts) and [`interaction-concepts.md`](./interaction-concepts.md)
> (the fourteen value-anchored interactions). This note asks one question of both:
> **is there anything here that would feel more at home on a phone than on a desk?**

The answer is yes, and the reason is not the obvious one. It isn't that phones are
convenient. It's that this product's central covenant — *the AI never writes your
prose* — is a rule the desktop has to enforce with willpower and the phone enforces
with physics.

---

## 1. The thesis: a tool that won't write for you belongs on a device you can't write on

Every concept in the two companion docs is built around a refusal. The AI asks,
quotes, notices, gathers, resurfaces, narrates, believes, doubts, and fades. Across
five concepts and fourteen interactions, the verbs that survived sketching were
*never* "write" or "fix" (interface-concepts.md, Principle 2). The whole design
problem is keeping the tool on the right side of that line.

On the desktop this is a constant, low-grade fight. The sidebar sits eighteen
inches from the document, the cursor is already blinking, and every suggestion is
one ⌘C away from being the writer's next paragraph. Concept after concept has to
invent machinery to resist it: wet-ink styling that expires if untouched, the debt
ledger, Blind Rewrite's paste-blocking, "noticed, not decided."

On a phone, that machinery is partly free. Typing a paragraph on glass is
miserable; typing it *twice* is unthinkable. A surface that is bad at composing
prose is not a degraded desktop for this product — it is a **purified** one. The
constraint the desktop has to simulate is simply the hardware.

This flips the usual porting question. The right question is not "how do we fit
Draft, Revise, and Chat onto a small screen?" It is: **which moments of writing
happen away from the desk, and what does the tool owe the writer then?**

Notably, the layout half of the port is already done by accident. The navbar and
page chrome are tuned for the Google Docs sidebar's locked ~300px
(`frontend/src/components/navbar/styles.module.css`, and the `MAX_CORE_PAGES`
derivation in `pages/registry.tsx`) — *narrower than an iPhone SE*. Nothing here is
blocked on responsive CSS. The gap is interaction idiom, not pixels.

---

## 2. What the phone actually has that the desk does not

Five primitives. Everything below is built out of them.

| Primitive | What it is | What it's worth here |
|---|---|---|
| **A microphone you carry** | Speech is available in situations where a keyboard isn't | Thinking out loud becomes an *input method*, not a transcription convenience |
| **Interstitial time** | The queue, the bus, the four minutes before a meeting | Time that is currently lost to writing entirely — not stolen from composing |
| **Encounter-time capture** | Share sheet, camera, clipboard, wherever you are | You meet the relevant book page, podcast, or screenshot *away from the desk* |
| **Reading conditions** | Small screen, one thumb, distracted, bright sun | This is your *reader's* situation, and you can't otherwise inhabit it |
| **Inability to edit comfortably** | The constraint, reframed as a feature | Marking, judging, and noticing without the escape hatch of fixing |

And one primitive that is a liability, addressed in §5: **the notification**, the
phone's native idiom of interruption, aimed straight at the covenant's fourth
commitment ("silence is a feature").

---

## 3. Five mobile-native concepts

Each is derived from an existing concept, and each is named with the moment it
owns rather than the feature it is.

---

### M1 — The Walk
#### Voice-native My Words, with the eyes-on-screen constraint finally relaxed

**Derived from:** My Words (`frontend/src/pages/my-words/`), and
[`my-words-voice-native-research.md`](../my-words-voice-native-research.md).

The voice research note commits to **hands-free, eyes-on-screen** — the writer
speaks, the document and highlights stay visible as shared reference. That note
calls the eyes-free distinction "load-bearing," and it is: at a desk, eyes-free
voice is strictly worse, because the screen is right there and free to use.

On a phone in a coat pocket, eyes-free stops being a degradation and becomes the
*only* available mode — and the one mode the desk can never offer. The Walk is My
Words with no document view at all.

The reason this works, and works only for this product, is `corpus.ts`. My Words
may place only the writer's own words — spans lifted verbatim from the document,
the scratchpad, and *what the writer says to it* — bridged by punctuation and a
closed set of glue words, enforced in code by `validateText`. Which means a voice
session cannot produce prose the writer didn't say. **The output of a walk is not
a draft. It's a shelf of your own sentences, with the machine's fingerprints
structurally absent.**

```
┌─────────────────────────────┐
│  ●  The Walk        14:32   │   ← lock screen / one-thumb
│                             │
│   "…so the real problem     │
│    isn't the cost, it's     │
│    that nobody trusts the   │
│    baseline numbers—"       │
│                             │
│         ▁▃▅▇▅▃▁             │   listening
│                             │
│  ┌───────────────────────┐  │
│  │ Say that again, the   │  │   ← one move, then yields
│  │ part about trust?     │  │      (the turn rule from the
│  └───────────────────────┘  │       interaction-design note)
│                             │
│  kept from this walk: 4     │
│  ─────────────────────────  │
│  ⏸  pause      ✓  end walk  │
└─────────────────────────────┘
```

Arriving back at the desk:

```
┌─────────────────────────────┐
│  FROM YOUR WALK · 22 min    │
│                             │
│  Nothing here is in your    │
│  document. These are your   │
│  words, waiting.            │
│                             │
│  ❝ nobody trusts the        │
│    baseline numbers ❞       │
│    said twice, 6 min apart  │
│                             │
│  ❝ we've been arguing about │
│    the price of a thing we  │
│    haven't measured ❞       │
│                             │
│  ❝ the audit is the ask ❞   │
│    ← you paused 9s after    │
│      this one               │
│                             │
│  [→ scratchpad]  [discard]  │
└─────────────────────────────┘
```

**What the AI pointedly does not do:** propose sentences, summarize the walk into
tidy prose, or decide what mattered. It replays. The one inference it makes visible
is *behavioral* — you said this twice; you went quiet after that — which is evidence
about the writer, not judgment about the text.

**Why it's more at home here:** the "think-aloud" tradition the research note cites
holds that speaking recruits different idea-generating pathways than typing. At a
desk that claim is hard to cash, because the keyboard is right there and speaking
feels like a worse keyboard. Walking, it's the only channel open. The word-bank
rule, which reads as a constraint in text, is the entire point in voice.

**Cheapest honest prototype:** no app. A voice memo, transcribed, run through
`buildCorpus` + `validateText` offline, returned as the shelf above the next
morning. Measure: does the writer use their own returned phrases, and do they say
things they wouldn't have typed?

---

### M2 — The Shelf
#### The Loom's someday shelf, on the device where you actually meet the material

**Derived from:** Concept 4 (The Loom), "the someday shelf" — *a zero-friction
inbox for sources not yet relevant; the AI's job is patience.*

The someday shelf is described in interface-concepts.md as a panel in a full-window
editor host. That is the wrong host, and the doc half-admits it: in the storyboard,
Dr. Okafor is **reading a book chapter** when she flings a reference at the shelf.
She is not at her desk. Nobody is at their desk when they encounter the thing.

The shelf's defining property is that filing costs zero. On mobile that isn't a
design goal, it's a system feature already built into the OS: the shelf is a
**share-sheet target**, plus a camera button, and nothing else.

```
┌─────────────────────────────┐
│  ← Share                    │   ← OS share sheet, any app
│  ┌───┐ ┌───┐ ┌───┐ ┌───┐    │
│  │   │ │   │ │ ◈ │ │   │    │
│  └───┘ └───┘ └───┘ └───┘    │
│   Msg  Mail  Shelf  More    │
└─────────────────────────────┘
        ↓  one tap, no dialog
┌─────────────────────────────┐
│  ◈  shelved.                │
│     nothing to file.        │
└─────────────────────────────┘   ← 1.5s, then gone
```

The shelf itself, on the rare occasion you open it:

```
┌─────────────────────────────┐
│  THE SHELF          41 ⌄    │
│                             │
│  ⟲ RESURFACED               │
│  ┌─────────────────────────┐│
│  │ "2019 audit.pdf"        ││
│  │ shelved 5 weeks ago     ││
│  │                         ││
│  │ relates to the para-    ││
│  │ graph you wrote Tuesday ││
│  │ (cost per student)      ││
│  │                         ││
│  │ [open] [not now] [🗑]   ││
│  └─────────────────────────┘│
│                             │
│  RECENT                     │
│  📷 book p.114 · Tuesday    │
│  🔗 podcast ep. 212 · Mon   │
│  ✂ "…attention is a gift"   │
│                             │
│  ─────────────────────────  │
│  composted (17) ⌄           │
└─────────────────────────────┘
```

The camera earns its place: photographing a book page is the single fastest path
from *encountering an idea* to *having it*, and it has no desktop equivalent at all.

**What the AI pointedly does not do:** summarize what you shelved, tag it, organize
it, or ask you to. Filing is the cost the shelf exists to eliminate. It also does
not notify — resurfacing waits for you to arrive (§5).

**Why it's more at home here:** this is the clearest case in the whole document
set. The desktop version of the shelf is strictly worse than the mobile version,
because the desktop version requires you to still have the thing, and still care,
by the time you get back to your desk. Automated patience is only worth having if
capture was free at the moment of encounter.

**Cheapest honest prototype:** a shared note or an email-to-self address as the
shelf, and a weekly LLM pass over the week's writing to produce at most one
resurfacing line. Measure: what fraction of shelved items are *ever* opened again —
and whether resurfacing beats the writer's own memory.

---

### M3 — The Commute Read
#### Read your draft in your reader's actual conditions, where you can mark but not fix

**Derived from:** Concept 5 (The Table Read) and interaction concept 9 (Skim View /
Reading Playback).

The Table Read's best moment is in its storyboard, and it's a moment about a phone:
Rosa realizes "the real reader is not 'the committee' but one hurried program
officer reading on a phone between meetings," and "that reframe alone changes her
opening."

The tool simulates that reader on a desktop. On a phone, you can just *be* one.

```
┌─────────────────────────────┐
│  ⟵  reading as: the officer │
│     6 min · one thumb       │
│  ───────────────────────    │
│                             │
│  The district's cost per    │
│  student has risen 34%      │
│  since the last review,     │
│  and the program's own      │
│  reporting has not kept     │
│  pace with that change.     │
│                             │
│  ░░░░░░░░░░░░░░░░░░░░░░     │  ← below the fold your
│  ░░░░░░░░░░░░░░░░░░░░░░     │    reader's first screen
│                             │    ends here
│  ─────────────────────────  │
│   😐 lost me    ⏱ too slow   │
│   ❓ what's the ask?         │
│  ─────────────────────────  │
│   🎤 read it aloud          │
└─────────────────────────────┘
```

Two things happen here that a desktop cannot stage honestly.

**The fold is real.** On a 375px screen, "what your reader sees before deciding
whether to keep reading" is not a simulation with a dotted line drawn across it —
it's just where the screen stops. Every writer knows their opening is too long; very
few have watched their opening *not fit*.

**Reading aloud is a diagnostic, and the mic is right there.** Tap 🎤 and read your
own draft out loud. The places your tongue trips, backs up, or re-reads are, with
uncanny reliability, the places the sentence is broken. The tool records where you
stumbled and marks those spots — it does not analyze your prose to find them. This
is the writer's own body producing the evidence, which is about as close to
"judgment stays home" as an interface can get.

And the crucial constraint: **there is no edit affordance on this screen.** You can
mark, and marking produces a worklist that's waiting at the desk. You cannot fix,
because fixing a sentence in situ is how a reading pass becomes a revising pass and
the read never finishes. On the desktop this rule would have to be enforced by
disabling something. Here it's just what a phone is like.

**What the AI pointedly does not do:** react, score, suggest, or narrate. On this
screen the AI's role is *staging* — reading conditions, the fold, the stumble marks.
The reactions are the writer's own.

**Cheapest honest prototype:** send yourself the draft as a plain web page sized to
a phone, read it aloud on a walk with the voice memo running, and hand-transcribe
the stumbles. Measure: do stumble locations predict the revisions the writer
actually makes?

---

### M4 — The Standing Question
#### One question, ninety seconds, answerable by thumb or by voice — and it never asks twice

**Derived from:** interaction concepts 4 (Predict-the-Reader) and 7
(Earn-the-Answer), plus the Charter's renegotiation prompt (Concept 1, Frame 5).

Several concepts hinge on the writer committing to their own answer *before* seeing
the AI's — the generation effect, made into interaction grammar. On the desktop
that's friction placed directly in the path of composing, and the honest risk is
that it gets clicked past.

Broken off as a phone-shaped unit, it stops being friction and becomes the entire
activity. It has exactly the shape of interstitial time: self-contained, no
document editing, no context to reload, ninety seconds, one thumb.

```
┌─────────────────────────────┐
│                             │
│   Before I show you mine:   │
│                             │
│   Name one question your    │
│   reader will have that     │
│   your draft doesn't        │
│   answer.                   │
│                             │
│  ┌───────────────────────┐  │
│  │                       │  │
│  └───────────────────────┘  │
│         🎤  or say it       │
│                             │
│                    [skip]   │
└─────────────────────────────┘
        ↓
┌─────────────────────────────┐
│   You said:                 │
│   "where the $40k came      │
│    from"                    │
│                             │
│   I had that one too.       │
│   ────────────────────────  │
│   I also had:               │
│   · why now and not in Q3   │
│   · who owns it after       │
│     year one                │
│                             │
│   overlap, last 6 asks:     │
│   ▁▂▃▃▅▅   improving        │
│                             │
│   [→ worklist]   [done]     │
└─────────────────────────────┘
```

That overlap sparkline is the product's actual thesis made checkable: *AI use should
improve your unaided work*, tracked as how well the writer predicts the AI before
seeing it. It is also, per interaction-concepts.md's research note, a publishable
dependent measure.

**What the AI pointedly does not do:** ask more than one. The screen has no "next
question" button. A second question would convert a moment of reflection into a quiz,
and the covenant's fourth commitment into a lie.

**Why it's more at home here:** on the desktop this competes with composing, and
loses. On the phone it competes with nothing — the alternative use of that time is
the queue.

**Cheapest honest prototype:** it already exists as a prompt. Run it as a daily
one-question text message during a diary study, with a human tracking overlap.
Measure: does predicted-vs-actual overlap rise over weeks?

---

### M5 — The Tideline
#### Your own sentences, months of them, as the one thing worth scrolling

**Derived from:** Concept 3 (Tidelines), element 4 — *progress shown not as a score
but as a shelf of the writer's own before/after sentences over months.*

The Tidelines wireframe puts the tideline in a Word task pane, where it is a panel
that competes for attention with the work. It will lose that competition every time,
because nobody opens a progress panel while writing.

But the artifact itself — a vertical, chronological, image-free feed of short
excerpts of your own best language — is *precisely* the shape of the thing people
scroll on phones for pleasure. That is not a cynical observation. It's the one place
where the phone's most habituated gesture points at something worth looking at.

```
┌─────────────────────────────┐
│  YOUR TIDELINE          ⌄   │
│  ───────────────────────    │
│                             │
│   JUNE                      │
│   ❝ Cancel the vendor       │
│     contract. Here's why. ❞ │
│                             │
│   ─────────                 │
│   APRIL                     │
│   ❝ Three things went       │
│     wrong in Q1; one of     │
│     them is fixable by      │
│     June. ❞                 │
│                             │
│   ─────────                 │
│   FEBRUARY                  │
│   ❝ This memo provides an   │
│     overview of several     │
│     considerations… ❞       │
│                             │
│   ─────────                 │
│   these are all yours       │
│                             │
│   retired: hedging ✓ (May)  │
└─────────────────────────────┘
```

Read-only. No input. No AI text anywhere on the screen — every word is the writer's
own, dated. The only editorial act is selection, and even that should show its work
(tap a card to see the document it came from).

**Why it's more at home here:** the desktop version is a panel you open when you
remember it exists. The phone version is what you look at while the coffee is being
made — and unlike everything else you'd look at then, reading it makes the case that
you are getting better at something. Tidelines' stated reward is "reading your own
tideline"; a phone is where reading-for-its-own-sake actually happens.

**Cheapest honest prototype:** a static page, generated weekly from the existing
JSONL logs, at a URL the writer bookmarks to their home screen. Zero app. Measure:
unprompted opens.

---

## 4. What does *not* belong on the phone

Being specific about this is what keeps the list above honest.

- **The Loom's threads, layers, and try-on structures.** Three panes, drag-to-
  rearrange, contradictory feedback pinned side by side so it can be *looked at
  together*. Cooper's information landscape needs landscape. This is desktop or
  nothing; interface-concepts.md already says a task pane can't hold it, and a phone
  is smaller than a task pane. The phone's honest role is the shelf (M2) and a
  read-only "what's live" glance.
- **Revise, as it exists.** Its whole value is doctext links that jump the document
  to a location (`revise/docTextJump.ts`). Without the document beside it, a jump
  target is just a quotation.
- **Draft, as it exists.** It serves the moment the cursor is stuck, which is by
  definition a moment at the keyboard.
- **The Charter's negotiation.** Rewriting five candidate criteria in your own words
  is real writing, and real writing wants a keyboard. What ports is the *check-in*:
  glance at the marks, notice #3 is dormant, decide to renegotiate later.
- **Anything with a text field taller than three lines.** A good test.

The pattern: **the phone gets capture, judgment, and reading; the desk keeps
composition and arrangement.** Every concept in §3 is one of the first three.

---

## 5. The covenant under mobile pressure

The shared covenant's fourth commitment is: *Silence is a feature. Nothing interrupts
composition.* Weiser's line in the imagined salon is sharper — "the most dangerous
default in this decade is the assistant that always has something to say."

The phone is the device where that default is most tempting and most damaging,
because its native idiom is the push notification and push notifications are how
engagement is bought. A tool aimed at its own obsolescence cannot want engagement.

**Proposed rule, stated plainly enough to be violated visibly:**

> **The phone may collect, and it may show. It may not summon.**

- **Collect** — the shelf, the walk, a stumble mark. Always available, always
  instant, never initiated by the tool.
- **Show** — the tideline, the resurfaced card, the overlap sparkline. Present when
  the writer arrives. Pull, never push.
- **Summon** — a notification that says *come look at what I found*. Not offered.
  Not as a setting, not as an opt-in default, not "just for streaks."

Two consequences worth accepting up front. The Loom's resurfacing (M2) becomes
*strictly* arrival-triggered: the 2019 audit waits on the shelf until Dr. Okafor
opens it, and if she never opens it, the resurfacing was worth nothing — which is
the correct price for the rule. And M4's Standing Question can never tap you on the
shoulder; it can only be there when you look. A home-screen widget is the sharpest
form of this: maximally glanceable, structurally incapable of interrupting.

If a writer explicitly negotiates one recurring nudge for themselves — the Charter's
weekly check-in, say — that is a Charter term, versioned and renegotiable like every
other, and it should live in `history ▾` where they can see they chose it.

---

## 6. What the codebase already has

A mobile companion here is closer to a fourth surface than a new product. Four
pieces are already built and load-bearing:

- **`detectPlatform()`** (`frontend/src/api/index.ts`) already returns
  `word | google-docs | standalone`, with `EditorAPI` as the seam. A phone companion
  is a fourth branch whose `EditorAPI` is mostly *unimplemented on purpose* — no
  insert, no selection-jump. Which is exactly §1's argument, expressed as an
  interface.
- **Device authorization, RFC 8628** (`frontend/src/api/deviceAuth.ts`). The flow
  for "pair this other device to my session" exists and is tested against the
  backend. Pairing a phone to a desk session is the flow it was built for.
- **Handoff grants with a document snapshot** (`frontend/src/api/handoff.ts`,
  `backend/src/toolGrants.ts`, `docs/tool-launcher-plan.md`). The taskpane can
  already mint a single-use, scope-limited grant carrying a read-only doc snapshot,
  delivered in a URL fragment. "Send this draft to my phone for the commute read"
  (M3) is `createHandoff` with `scopes: ['doc:read']` and a QR code instead of an
  `openInBrowser` call.
- **Layout at 300px.** Already the design constraint (`MAX_CORE_PAGES`,
  `navbar/styles.module.css`), and narrower than the phones in question.

What genuinely doesn't exist yet: a realtime voice session that survives the screen
locking (M1), share-sheet registration (M2, needs a real installed app or a PWA
share target), and per-session cost metering for voice — the reason My Words is
flagged off in `pages/registry.tsx` today.

Worth noting the current posture, too: `backlog/tasks/task-25` describes a study
gate that **blocks mobile devices outright**. That's correct for the experiment's
three-panel task layout, and it is worth being explicit that nothing here proposes
relaxing it. These are different surfaces for different moments, not a responsive
version of the same screen.

---

## 7. The five at a glance

| | Moment it owns | Phone primitive | Derived from | Ports to desktop? |
|---|---|---|---|---|
| **The Walk** | Away from the desk, thinking | microphone + interstitial time | My Words voice | Worse — the keyboard competes |
| **The Shelf** | Encountering material | share sheet + camera | Loom, someday shelf | Worse — you no longer have the thing |
| **The Commute Read** | Before sending | reader's conditions + no edit affordance | Table Read, Skim View | Worse — the fold is simulated |
| **The Standing Question** | Four spare minutes | interstitial time | Predict-the-Reader, Earn-the-Answer | Worse — competes with composing |
| **The Tideline** | Idle attention | the scroll gesture | Tidelines | Worse — a panel nobody opens |

The right-hand column is the actual answer to the question this note opened with.
All five are *better* on the phone, and for the same underlying reason: each one
depends on the writer **not being able to immediately act on what they've seen.**
The gap between noticing and fixing is where the thinking happens, and the phone
enforces that gap for free.

**If only one gets built: The Shelf (M2).** It has the largest gap between mobile
and desktop value, the smallest surface area, no realtime infrastructure, no model
call in the capture path at all, and it makes the Loom — the biggest and least
tractable of the five original concepts — testable years before the Loom itself
could ship.

**Sleeper pick: The Commute Read (M3),** because it needs no new backend at all —
`createHandoff` with `doc:read` and a QR code — and because "watch your own opening
not fit on the screen" is the kind of demo that changes a writer's mind in eight
seconds.
