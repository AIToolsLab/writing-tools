# P1 — Co-construction vs. handed-down rubric

**Audience:** Education / learning sciences (also CHI). **Testbed:** main frontend.
**One-line:** Is the *making* of the rubric where the learning happens?

## Concept

The rubric can arrive three ways. It can be **handed down** (an assignment
rubric loaded as context, the agent audits against it), **agent-proposed** (the
agent drafts criteria, the writer approves them), or **co-constructed** — the
agent elicits criteria Socratically, one at a time, from the writer's own sense
of the task, and each is negotiated before it joins the list.

Boundary-object theory (Star & Griesemer 1989) and the negotiated-criteria
literature in education predict that the *act of co-construction* — not the
resulting list — is what builds shared understanding, ownership, and a
transferable sense of "what good looks like." Flower & Hayes (1981) locate
goal-setting inside the writer; co-construction externalizes and scaffolds it.
Sommers (1980) predicts the downstream signature: writers who own a global
rubric revise for *meaning*, not just surface.

```
     WHERE THE RUBRIC COMES FROM  →  WHAT THE WRITER INTERNALIZES

  handed-down     agent-proposed        co-constructed
  ┌────────┐      ┌────────┐            ┌────────┐
  │ rubric │─►□   │ agent  │─►rubric─►□ │ agent ⇄ writer │
  └────────┘      │ drafts │  ┌approve┐ │  one criterion │
   writer:        └────────┘  └───────┘ │  at a time      │
   "received"      writer:              └────────┬────────┘
                   "reviewed"            writer: "authored"
       low ────────── ownership / internalization ────────── high
```

## Hypotheses

- **H1 (internalization).** Co-construction → writers can restate and *justify*
  more criteria unaided (recall + rationale), vs. handed-down.
- **H2 (revision altitude).** Co-construction → higher share of meaning-level
  revisions (Faigley & Witte coding), vs. handed-down.
- **H3 (ownership, cost).** Ownership/agency higher under co-construction, but
  time-on-task is higher (the cost side of the trade).
- **H4 (transfer).** On a later, *unaided* writing task, co-construction writers
  generate higher-quality criteria of their own.

## Design

Between-subjects, 3 conditions (handed-down / agent-proposed / co-constructed);
one authoring session + a delayed unaided transfer task (feeds the fading
follow-on). **Measures:** criteria recall+justification, Faigley-Witte revision
coding, ownership scale, expert-blind draft quality, time-on-task. **Watch:** the
*time confound* (co-construction takes longer) — add a time-matched control or
model time as a covariate; and elicitation quality (hold the agent's questioning
fixed via a scripted policy).

## Two example interactions

**(A) Co-constructed — eliciting one criterion**
> **Writer:** It's a cover letter for a research assistantship.
> **Agent:** Before we touch the words — who's the skeptic reading this, and
> what would make *them* nod? Say it however you'd say it.
> **Writer:** The PI. She'd want to see I actually get her lab's work, not
> generic enthusiasm.
> **Agent:** So a criterion like *"shows specific understanding of the lab's
> work"* — worth putting on our list to check against later?
> **Writer:** Yeah, and that it doesn't sound like a form letter.
> **Agent:** Two, then: *specific fit to the lab* and *not boilerplate*. Added.
> What else has to be true for this to land?

**(B) Handed-down — same doc, received rubric**
> **Agent:** Here's the assignment rubric I'll evaluate against: (1) demonstrates
> fit, (2) professional tone, (3) concrete evidence, (4) concise. Ready when you
> want me to check the draft.
> **Writer:** ok.
> *(No negotiation; the writer never articulates the "skeptical PI" framing in
> their own terms.)*

## UX — storyboard of the elicitation turn

```
 ┌── panel 1 ──────────┐  ┌── panel 2 ──────────┐  ┌── panel 3 ──────────┐
 │ agent asks:         │  │ writer answers in   │  │ agent reflects it   │
 │ "who's the skeptic  │  │ their own words     │  │ back AS a candidate │
 │  and what makes     │  │ ┌─────────────────┐ │  │ criterion + asks    │
 │  them nod?"         │  │ │ the PI... not   │ │  │ consent             │
 │                     │  │ │ generic         │ │  │ ┌─────────────────┐ │
 │  [ your words ▾ ]   │  │ └─────────────────┘ │  │ │+ specific fit ✓ │ │
 └─────────────────────┘  └─────────────────────┘  │ │  [Add] [Reword] │ │
                                                    │ └─────────────────┘ │
   criterion enters the shared list only AFTER the writer's assent  ──────┘
```

## Related work
Star & Griesemer 1989 (boundary objects); Flower & Hayes 1981; Bereiter &
Scardamalia (knowledge-telling/transforming); Sommers 1980; Faigley & Witte 1981;
Andrade & negotiated-criteria in assessment; Vygotsky / Wood, Bruner & Ross
(contingent scaffolding).
