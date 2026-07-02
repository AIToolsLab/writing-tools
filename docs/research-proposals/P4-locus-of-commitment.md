# P4 — Locus of commitment for goals (the my-words axis, lifted)

**Audience:** HCI (mixed-initiative interaction). **Testbed:** my-words branch.
**One-line:** my-words already asks *who holds the pen* (propose vs. walkthrough);
this asks *who holds the goal* — and whether people want those set differently.

## Concept

The my-words prototype defines a **commitment axis** for edits: *Propose*
(nothing changes until the writer consents) vs. *Walkthrough* (the agent acts,
the writer reacts and steers). This proposal lifts that exact axis from **words**
to **criteria**:

- **Propose-goals** — the agent stages a candidate criterion; it joins the shared
  list only on the writer's accept.
- **Walkthrough-goals** — the agent adds tentative criteria as it reads and the
  writer prunes/steers.
- **Writer-authored** — the writer sets criteria; the agent only assesses.

Because the *same* axis now exists at two layers (word vs. goal), we can cross
them and ask a question mixed-initiative theory (Horvitz 1999; LOA taxonomies)
hasn't pinned down for writing: **do people calibrate control differently for the
ends (goals) than for the means (words)?** A rubric feels closer to authorial
intent, so we predict a demand for *more* control over goals than edits.

```
         THE AXIS, AT TWO LAYERS

               writer holds ●─────────────● agent holds
   WORDS  (edits)   propose ───────────── walkthrough     ← my-words today
   GOALS  (criteria) propose ───────────── walkthrough     ← this proposal

   crossed 2×2 (edit-locus × goal-locus):

                      edit: propose     edit: walkthrough
   goal: propose      max control        "I set the aims,
                      (slow, safe)        you draft freely"
   goal: walkthrough  "aims emerge,       max agent initiative
                       words are mine"    (fast, least ownership)
```

## Hypotheses

- **H1 (layer asymmetry).** For a fixed comfort level, writers prefer a
  *higher-control* locus for goals than for edits (a layer × locus interaction).
- **H2 (richness vs. ownership).** Walkthrough-goals surfaces *more* criteria
  (richer rubric) but yields *lower* goal ownership than Propose-goals.
- **H3 (consistency).** Writers who chose high control over edits also want it
  over goals (a within-person control disposition).

## Design

Reuse the existing `InteractionStrategy` seam: add goal-authoring strategies that
mirror `propose.ts` / `walkthrough.ts`, staging *criteria* the way those stage
*edits* (the `Awaiting = message | continue | decision` states already model
"staged, awaiting accept"). Within-subjects across goal-locus, ideally crossed
with edit-locus. **Measures:** ownership per layer (separate goal- and
word-ownership items), rubric richness/quality, felt collaboration, and a forced
preference. **Watch:** ordering/anchoring across the 2×2 (counterbalance);
walkthrough-goals can flood the list — cap criteria per turn (one move per turn,
per the design note).

## Two example interactions

**(A) Propose-goals** *(criterion staged, gated like a proposed edit)*
> **Agent:** Reading this, I think a skeptical reader needs to believe the method
> is *reproducible*. Add *"method is reproducible"* to what we're aiming for?
> **[Accept] [Not yet]**
> **Writer:** Not yet — reproducibility isn't the point here, novelty is.
> **Agent:** Got it — dropping reproducibility. Should *"makes the novelty
> obvious"* be on the list instead?

**(B) Walkthrough-goals** *(agent adds tentatively; writer prunes)*
> **Agent:** I've jotted three aims as I read — *clear thesis*, *reproducible
> method*, *concise*. Cross out any that aren't yours.
> **Writer:** kill "reproducible", keep the rest.
> **Agent:** Done. I'll hold us to *clear thesis* and *concise*, and tell you when
> the draft drifts from them.

## UX — the criteria rail with staged vs. landed items

```
 ┌── your words (scratchpad) ─────────────────────────────┐
 │  … the writer types their raw material here …          │
 └────────────────────────────────────────────────────────┘
 ┌── what we're aiming for ───────────────────────────────┐
 │  ✓ makes the novelty obvious            (landed)        │
 │  ✓ concise                              (landed)        │
 │  ┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈ │
 │  ⟳ method is reproducible   [Accept] [Not yet] (staged) │◄ Propose
 └────────────────────────────────────────────────────────┘
   Walkthrough variant: new items appear already-landed with a
   subtle "new" dot and a one-tap [✗ not mine] to prune.
```

## Related work
Horvitz 1999 (mixed-initiative); Parasuraman, Sheridan & Wickens 2000 (levels of
automation); the my-words interaction design note (commitment axis; grounding;
turn-taking); Clark & Brennan (grounding / acceptance phase).
