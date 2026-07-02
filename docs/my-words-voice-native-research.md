# My Words — Voice-Native Conversation: Research Note

**Status:** research exploration. What it would take to turn the My Words
prototype into a *fluent, voice-native* writing collaborator — the technical
architecture (smart *and* responsive), the interaction design (largely
hands-free, genuinely collaborative), the platform options, and the questions
worth resolving before building.

**Companion to** `docs/my-words-interaction-design.md` (the text-prototype design
brief; branch `claude/mywords-interaction-design-cuvkl3`). That note argues the
*turn* should be one conversational move, then yield the floor. This note asks
what happens when the floor is made of *sound*.

**Pair with that note; don't restate it.** Its turn-taking / grounding /
mixed-initiative theory carries over wholesale — in voice it stops being an
analogy and becomes literal.

---

## 0. Decisions this note is written against

Three choices are already made (with the user); the note commits to them rather
than re-opening them:

- **Deliverable:** this note. No code in this pass.
- **Async ambition for v1:** *single voice model + upfront guidance.* A big model
  reasons **once, before** the conversation, and hands a brief to a fast realtime
  voice model. The continuous "reasoning sidecar" is a later stage, not v1.
- **Modality:** **hands-free, eyes-on-screen.** The writer speaks; the document
  and highlights stay visible as shared reference. (Not eyes-free — that
  distinction turns out to be load-bearing; see §3.2.)

The motivation is equally explicit: the current interaction **doesn't yet feel
collaborative**. Voice is not a port of the text loop — it's the occasion to fix
that.

---

## 1. What "voice-native" should mean here

Not dictation. Not voice-commands bolted onto a chatbot. The target is a
**writing conference held out loud**: the writer talks through what they're
trying to say; the partner listens, reflects it back, and makes one small move at
a time in the writer's own words.

The reframe that makes this special is the prototype's existing hard constraint.
My Words may only use the **writer's own words** — from the document, the
scratchpad, and *what the writer says to it* — joined by punctuation and glue
words (enforced in code by `validateText` / `corpus.ts`). In text, "what they say
to it" is a typed message. **In voice, it's the main event.** Speech stops being
a *command channel* and becomes the **primary way new material enters the
corpus**:

> Think out loud, and I'll shape what you just said into your document — in your
> words.

That is a materially more collaborative stance than "voice commands to edit
text," and it aligns with a well-worn observation in the writing literature:
speaking recruits different idea-generating pathways than typing (the
"think-aloud" / "learning out loud" tradition). The word-bank rule, which can
feel like a constraint in text, becomes the *point* in voice: the tool is a lathe
for the writer's own spoken thought.

Concretely, `buildCorpus` gains a live source — a rolling transcript of "what the
writer just said" — alongside the document and scratchpad.

---

## 2. The technical axis — smart *and* responsive

### 2.1 The tension is real and measured

You cannot assume a realtime voice model is as smart as the current text loop.
The τ-Voice benchmark (2026) finds real-time voice agents retain only **~30–45%
of the underlying text model's reasoning ability** — where a strong text model
scores ~85% on a reasoning task, the same intelligence wired into a live voice
loop lands at 31–51%. The trade is structural:

| Architecture | Responsiveness | Reasoning retained | Notes |
|---|---|---|---|
| **Speech-to-speech** (OpenAI Realtime, Gemini Live native audio) | Highest — one model hears, thinks, speaks | Lowest — biggest drop vs text | Natural prosody, easy barge-in; reasoning ceiling is the constraint |
| **Cascaded** (ASR → text LLM → TTS) | Historically laggy / turn-based | Highest — full text-LLM smarts | Modular, easy to instrument; VAD segmentation makes it feel half-duplex |
| **Hybrid / micro-turn** (e.g. DuplexCascade) | Near-S2S feel | Near-cascaded smarts | Chunk-wise "micro-turns" over a strong text LLM; the current sweet spot |

**Implication:** budget intelligence deliberately. The realtime layer will be the
weakest reasoner in the system; design so it doesn't have to carry the hard
thinking alone.

### 2.2 The user's async idea is a published pattern

The instinct — *a big model reasons asynchronously and steers the fast voice
model* — is not a hack; it's an emerging architecture. **AsyncVoice Agent**
(arXiv 2510.16156) decouples a streaming reasoning backend from a conversational
voice frontend so **narration and inference run in parallel**, and lets the user
**interrupt and steer the reasoning mid-flight**, reporting a >600× latency
reduction versus a monolithic model at competitive accuracy. The "pre-name the
next move" idea already in the companion design note (§4.2 there) is the same
family as **Speculative Interaction Agents** (2605.13360) and **Asynchronous Tool
Usage for Real-Time Agents** (2410.21620): compute the likely next step ahead of
the user's "ok" so acceptance applies instantly.

Our v1 is the *cheapest degenerate case* of AsyncVoice: reason once, up front,
instead of continuously.

### 2.3 Recommended v1 architecture: "brief-then-converse"

1. **Reason once, up front.** Before the conversation, a big model (GPT-5.5-class,
   the existing text pipeline) reads the document + scratchpad and produces a
   short **strategy brief**: what the writer seems to be trying to say, the 2–3
   highest-value moves available, and *what to listen for*. One call, cheap,
   entirely reuses today's text stack.
2. **Inject the brief as guidance** into the realtime voice model's session /
   system prompt. The voice model runs the live turn-taking loop; the brief
   compensates for its lower reasoning ceiling — it arrives already knowing the
   plan, so it spends its limited smarts on *being present*, not on strategizing.
3. **Keep the document layer text-side and unchanged.** The voice model calls the
   same tools the text prototype already defines — `view`, `str_replace`,
   `insert`, `move`, `highlight` — which are schema-only (no `execute`) in
   `interaction/liveResponder.ts`, so an `InteractionStrategy` still owns
   commitment and `ops.ts` + `validateText` remain the single source of truth.
   Voice is the *conversation* layer; the *editing* layer is what we already have.

This drops in behind the existing seam: a new `VoiceResponder` implementing the
same `Responder` interface (`interaction/types.ts`) as `createLiveResponder`,
feeding the same strategies (`walkthrough`, `propose`). The architecture the text
prototype built for swappability is exactly what makes voice additive rather than
a rewrite.

**Staging path (name it, don't build it):**

```
v1  reason once up front  ─▶  v2  re-brief periodically   ─▶  v3  continuous sidecar
    (chosen)                     (every N turns / on           (AsyncVoice-style,
                                  topic shift)                  interruptible)
```

Each stage is additive; nothing in v1 is thrown away to reach v3.

### 2.4 Fluency is a turn-taking problem, not a latency number

What makes voice *feel* conversational is not raw speed but **turn-taking
competence**:

- **Semantic VAD** — deciding the writer is *done* using meaning + prosody, not
  just silence (so it doesn't cut off a mid-thought pause). AssemblyAI, OpenAI
  Realtime (semantic_vad), and Smart-Turn-style detectors all do this now.
- **Barge-in** — the writer can talk over the partner and it stops immediately.
- **Backchannels** — "mm-hm," "right" — evidence of listening without taking the
  floor.
- **Holding its tongue** — the hardest and most collaborative behavior: staying
  silent while the writer thinks aloud.

This is the companion note's turn-construction-unit / transition-relevance-place
theory made literal. In text it was a metaphor for "when does the model get to
act"; in audio it's the actual mechanic, with real acoustic signals to detect it.

### 2.5 A subtlety: ASR errors and the word bank

Because spoken words enter the corpus, a *misheard* transcript could become
"legal" material the model then reuses — and `validateText` would happily accept
it because it now matches the (wrong) corpus. Decide early: does corpus admission
of spoken words need a lightweight confirmation beat, a confidence threshold, or a
"you can always fix the transcript" affordance? This interaction between ASR and
the word-bank rule has no analog in the text prototype.

---

## 3. Learn from what's already out there

Three literatures are directly relevant; the user named the first two explicitly.

### 3.1 Writing with speech / voice composition

- **Rambler** (CHI'24 — [2401.10838](https://arxiv.org/abs/2401.10838)) — its
  premise is our premise: dictated speech is "disfluent, wordy, and incoherent"
  and needs heavy post-processing. Its answer is **gist manipulation** plus
  macro-revisions (respeak / split / merge / transform) so the writer edits
  *meaning*, not transcribed words. Lesson for us: give the writer moves over the
  *gist* of what they said, not word-level cleanup.
- **StepWrite** (UIST'25 — [2508.04011](https://arxiv.org/abs/2508.04011)) — the
  closest existing "fluent, hands-free" system: long-form composition via an
  **adaptive Q&A** that offloads context-tracking and planning to the model and
  guides the writer with contextual audio prompts, cutting cognitive load without
  taking over. Its adaptive-prompt loop is a concrete model for our upfront brief
  and (later) the re-briefing stage.
- **Speakerly** ([2310.16251](https://arxiv.org/abs/2310.16251)) — a shipped
  voice-based writing assistant; useful as a systems reference point.

### 3.2 Conversational text entry / dictation-as-interaction

- **Toward Interactive Dictation**
  ([2307.04008](https://arxiv.org/abs/2307.04008)) — surfaces the single hardest
  problem in voice writing: **command vs. content disambiguation.** When the
  writer says something, is it *material* to add, or an *instruction* about the
  document ("no, cut that")? We need an explicit stance, not a guess per
  utterance.
- **Voice-correction literature** (talk-and-gaze error correction, CHI'20;
  voice+touch multimodal editing; disfluency detection) converges on one blunt
  finding: **pure voice is bad at specifying *location*.** "Fix *that* line" fails
  without a shared visual anchor. This is *why* we chose hands-free-but-**eyes-on**
  and why the `highlight` tool matters: the screen carries the deixis ("that")
  that speech can't. Hands-free ≠ eyes-free.

### 3.3 Collaborative / mixed-initiative co-writing

- **Co-Writing with AI, on Human Terms**
  ([2504.12488](https://arxiv.org/abs/2504.12488)); the mixed-initiative
  co-creativity **design space** ([2305.07465](https://arxiv.org/abs/2305.07465));
  and the CSCW thread on **agency and ownership** in co-writing. The through-line
  answers the "not collaborative yet" complaint directly: collaboration is felt
  through **turn-taking, negotiation, and preserved authorial ownership** — not
  through output quality. My Words already has an ownership mechanism (the
  word-bank rule); what it lacks is a *negotiation channel*. Real-time voice
  turn-taking **is** that channel.

### 3.4 Speech-dialogue mechanics (supporting)

- **Think-Verbalize-Speak** ([2509.16028](https://arxiv.org/abs/2509.16028)) and
  **SHANKS: Simultaneous Hearing and Thinking**
  ([2510.06917](https://arxiv.org/abs/2510.06917)) — decouple reasoning from
  speech-ready delivery, and think *while* listening. Both support the
  brief-then-converse split and, later, the continuous sidecar.

---

## 4. Interaction design for genuine collaboration

Re-anchor on the companion note's principles — grounding, adjacency pairs,
contingent scaffolding, repair — and make each audio-native:

- **One move, then yield → literal floor-passing.** The writer's spoken "yeah / go
  on" is a **backchannel continuer**, not a typed "ok". The partner makes one move
  and stops talking.
- **Pre-named next move is *more* valuable in voice.** "Want me to move that line
  up to open the paragraph?" → "yeah" applies instantly (speculative execution).
  A chain of "yeah… yeah… yeah" becomes a collaborator walking the writer
  through it, spoken — the opposite of a silent slab of edits.
- **Dual-channel feedthrough.** The writer *hears* a one-line narration **and**
  *sees* the edit + highlight land. Awareness the text version couldn't give,
  because speech and screen update the same moment.
- **Repair gets cheap.** Barge-in is early self-repair made trivial — design *for*
  interruption, don't fight it.

**Open design axes to resolve during build** (enumerated, not settled here):

- **Content vs. command** (§3.2) — the disambiguation stance. A likely default:
  treat speech as *content* by default and require a light explicit marker (or an
  obvious editing verb) for commands, with easy repair when wrong.
- **How eagerly may the partner edit while the writer is still talking?**
  Mixed-initiative granularity vs. the cost of acting on a half-finished thought.
- **Backchannel policy** — when the partner should murmur assent vs. stay fully
  silent.
- **Review-out-loud** — how the writer inspects *what changed* without reading a
  slab: spoken diff summaries, "read me the new version," highlight-and-narrate.

---

## 5. Platform / stack options

| Option | Shape | Why / when |
|---|---|---|
| **LiveKit Agents** *(recommended default)* | WebRTC rooms; pluggable STT/LLM/TTS **and** S2S plugins (OpenAI Realtime, Gemini Live) | Already in use on another project; cleanest agent API; self-hostable; **doesn't lock** the S2S-vs-cascaded choice, and injecting the upfront brief is straightforward. Room model gives room for a future 3rd "reasoning" participant. |
| **Pipecat** | Python frame-processor pipeline (v1.0, 2026) | Max control over micro-turn behavior; heavier; choose if we want to own the media pipeline. |
| **AssemblyAI Voice Agent API** | Single managed connection (STT+LLM+TTS), ~$4.50/hr, strong **semantic turn detection** | Fastest path to a feelable demo; least architectural control. Good for a throwaway "does this feel collaborative?" probe. |
| **OpenAI Realtime (gpt-realtime-2)** / **Gemini Live (native audio)** | The S2S engines themselves | Highest responsiveness, lowest reasoning ceiling — exactly what the upfront brief shores up. Consumed *inside* LiveKit/Pipecat rather than adopted raw. |

**Recommendation:** LiveKit for v1 — it lets us start S2S (fast to feel) and swap
toward hybrid/cascaded (smarter) without changing the app, and it's a stack the
team already knows.

**Host constraint to verify early.** My Words runs both inside a **Microsoft
Office add-in taskpane** (a webview) and **standalone via Vite**
(`frontend/mywords-demo.html`, `frontend/src/pages/my-words/demo/`). Mic capture +
WebRTC inside the Office webview is not guaranteed and needs a spike; the
**standalone build is the safer first target** for a voice prototype.

---

## 6. Questions worth resolving (some you may not be weighing yet)

- **Latency budget & where it's spent.** ASR + reasoning + TTS stack up; what
  round-trip actually *feels* conversational (rough target: first sound well under
  ~800 ms)? Which stage do we protect?
- **Content vs. command** — the hardest UX call; needs a default and a repair path
  (§3.2, §4).
- **Deixis / "that one."** Pure voice can't point — this is the whole reason for
  eyes-on-screen. How does the writer refer to a passage: by quoting it, by gaze,
  by tap-while-speaking?
- **ASR errors polluting the word bank** and their interaction with `validateText`
  (§2.5).
- **Barge-in & backchannel etiquette** — who may interrupt whom, and when *silence*
  is the correct move.
- **Privacy / always-listening.** Open mic vs push-to-talk; where audio is
  processed; and study-logging implications for the backend's JSONL study logs
  (audio and transcripts are more sensitive than typed chat).
- **Evaluation — how do we *measure* "collaborative" and "fluent"?** Candidate
  signals: turn latency, floor-exchange rate, repair cost/frequency, edit
  acceptance rate, and ownership/agency self-report. Reuse the companion note's
  side-by-side demo methodology (record two conditions, let the documents and the
  videos visibly diverge).
- **Cost at conversation length** — managed (~$4.50/hr) vs self-hosted budget
  stacks (~$0.03–0.05/min); does an always-listening session change the economics?
- **Accessibility upside (state it as motivation).** Voice + word-bank is a strong
  fit for writers for whom typing is hard or slow; that's a reason to build this,
  not just a nice-to-have.

---

## 7. Recommendation & staged path

**v1 — brief-then-converse**, on **LiveKit**, in the **standalone** build:
a single realtime voice model handed one **upfront strategy brief**, reusing the
existing `view/str_replace/insert/move/highlight` tools, `ops.ts`, and
`validateText`, behind a new `VoiceResponder` that satisfies the current
`Responder` seam. Spend the design effort on the three things that actually make
it collaborative: **turn-taking fluency**, **content-vs-command disambiguation**,
and **on-screen deixis**.

**Later — additive stages:** re-brief periodically (v2) → a continuous,
interruptible AsyncVoice-style reasoning sidecar (v3).

The bet: the word-bank rule plus real-time turn-taking is the combination that
makes My Words finally feel like *writing with someone* rather than having writing
done *at* you.

---

## References

**Voice-agent architecture & benchmarks**
- τ-Voice: Benchmarking Full-Duplex Voice Agents — https://arxiv.org/abs/2603.13686
- DuplexCascade: Full-Duplex VAD-Free Cascaded Pipeline — https://arxiv.org/abs/2603.09180
- AsyncVoice Agent: Real-Time Explanation for LLM Planning & Reasoning — https://arxiv.org/abs/2510.16156
- Speculative Interaction Agents — https://arxiv.org/pdf/2605.13360
- Asynchronous Tool Usage for Real-Time Agents — https://arxiv.org/pdf/2410.21620

**Writing with speech / text entry**
- Rambler (CHI'24) — https://arxiv.org/abs/2401.10838
- StepWrite (UIST'25) — https://arxiv.org/abs/2508.04011
- Speakerly — https://arxiv.org/abs/2310.16251
- Toward Interactive Dictation — https://arxiv.org/abs/2307.04008
- Leveraging Error Correction in Voice-based Text Entry by Talk-and-Gaze (CHI'20) — http://www.yorku.ca/mack/chi2020b.html

**Collaborative / mixed-initiative co-writing**
- Co-Writing with AI, on Human Terms — https://arxiv.org/abs/2504.12488
- Beyond Prompts: Design Space of Mixed-Initiative Co-Creativity — https://arxiv.org/abs/2305.07465

**Speech-dialogue mechanics**
- Think-Verbalize-Speak — https://arxiv.org/abs/2509.16028
- SHANKS: Simultaneous Hearing and Thinking — https://arxiv.org/abs/2510.06917

**Platforms**
- LiveKit Agents — https://github.com/livekit/agents
- Pipecat — https://www.pipecat.ai
- AssemblyAI Voice Agent API — https://www.assemblyai.com/products/voice-agent-api
- OpenAI Realtime (voice agents) — https://developers.openai.com/api/docs/guides/voice-agents
- Gemini Live API — https://ai.google.dev/gemini-api/docs/live-guide
