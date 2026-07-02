# P5 — Content withheld, direction shared (the my-words signature)

**Audience:** HCI + communication (authorship, voice, agency). **Testbed:** my-words.
**One-line:** my-words withholds the agent's *words*; a rubric shares the agent's
*direction*. Which combination keeps the writing *theirs* while making it better?
**Status:** high-payoff, higher measurement risk (voice is hard) — flagged.

## Concept

The my-words word-bank is a stance about *authorship*: the agent may rearrange
and tighten but never *originate words* — voice stays the writer's. A co-created
rubric adds a second, orthogonal lever: the agent can share **direction** (goals)
even while withholding **words**. Crossing them gives a clean 2×2:

```
                    AGENT MAY ADD WORDS?
                     no (my-words)     yes (ordinary AI)
                 ┌───────────────────┬───────────────────┐
   SHARE   no    │  pure own-words   │  free ghostwriter │
   GOALS?        │  tool (no aim)    │  (agent drives)   │
   (rubric)      ├───────────────────┼───────────────────┤
           yes   │  ★ words yours,   │  co-author on     │
                 │    aims shared    │  both layers      │
                 └───────────────────┴───────────────────┘
      ★ = the hypothesis-of-interest cell: maximal *direction* with
          minimal *authorship dilution*.
```

The bet: the ★ cell captures much of the quality gain of a full co-author while
preserving ownership and voice — because what the writer *feels* as authorship
tracks whose *words* are on the page more than whose *ideas* shaped the plan.
That would be a dissociation between **actual textual contribution** and
**perceived authorship** worth reporting on its own.

## Hypotheses

- **H1 (voice).** Withholding words preserves stylometric voice-consistency and
  self-reported ownership, *regardless* of whether goals are shared.
- **H2 (direction).** Sharing goals improves rhetorical/structural quality *even
  when words are withheld* (the ★ cell beats bottom-left).
- **H3 (best trade-off).** ★ dominates the top-right free-ghostwriter cell on
  ownership at comparable quality.
- **H4 (dissociation).** Perceived authorship stays high in ★ despite the agent
  having shaped the goals — felt authorship ≠ textual authorship.

## Design

2×2 within- or between-subjects (words-shared × goals-shared) built as product
variants of the my-words page (toggle the word-bank validator; toggle the rubric
layer). **Measures — mixed methods, because "voice" resists a single number:**
- *Voice/ownership:* validated ownership & agency scales; a "does this still sound
  like you?" reader-panel judgment (writer's own earlier samples as anchor).
- *Voice, quantitative:* stylometric distance from the writer's baseline corpus;
  proportion of final text that is the writer's own words (the corpus validator
  already computes lifted-vs-glue).
- *Quality:* expert-blind rubric-independent rating.
- *Felt authorship:* single-item + interview on "who wrote this?"

**Watch (the honest risks):** voice is partly in the eye of the reader — lean on
reader panels + interviews, don't over-trust stylometry; the word-bank constraint
can *hurt* fluency, a confound with voice — measure fluency separately; the ★ cell
is unusual, so novelty effects need a longer exposure.

## Two example interactions

Same shared goal — *"open with the stakes, not the background"* — satisfied two
ways:

**(A) ★ cell — direction shared, words withheld (my-words)**
> **Agent:** Our aim was to lead with the stakes. Your last paragraph already has
> the line *"a missed diagnosis costs a life"* — I'd move that to the top and let
> the background follow. Want me to? *(no new words — only the writer's, relocated)*
> **Writer:** yes.
> **Agent:** Moved. The opening is now your sentence, just earlier.

**(B) Top-right — direction shared, words free (ordinary co-author)**
> **Agent:** To lead with the stakes, I'd open with: *"In emergency medicine,
> seconds separate recovery from catastrophe."* Shall I add it? *(fresh words,
> not the writer's)*
> **Writer:** …that's good, but it doesn't sound like me.

## UX — the four variants as a storyboard

```
  bottom-left            ★ top-left            top-right
  ┌──────────────┐       ┌──────────────┐      ┌──────────────┐
  │ no rubric    │       │ RUBRIC ▸ aims│      │ RUBRIC ▸ aims│
  │ own-words    │       │ own-words    │      │ agent words  │
  │ only         │       │ only         │      │ allowed      │
  │              │       │ agent MOVES  │      │ agent WRITES │
  │ "shape it in │       │ your line to │      │ a new opener │
  │  your words" │       │ the top ↑    │      │ for you      │
  └──────────────┘       └──────────────┘      └──────────────┘
        │                      │                      │
   direction: none       direction: shared      direction: shared
   authorship: pure       authorship: pure       authorship: diluted
```

## Related work
my-words interaction design note & `corpus.ts` (word-bank); authorship / voice &
ownership-of-AI-writing literature; Bainbridge 1983 (ironies of automation);
distributed cognition; Flower & Hayes (goals live in the writer) — here goals are
*shared* but words are not.
