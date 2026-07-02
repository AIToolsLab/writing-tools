# Research Proposals — a co-created rubric the agent evaluates against

**What this is.** A set of research-proposal one-pagers exploring a single
feature idea: the AI "coworker" and the writer **co-create a to-do list / rubric**
for a document, the agent **evaluates whether the draft satisfies** it, and the
**discussion is organized around those todos**. Rather than commit to one
product direction, we pull the idea apart into independently-testable research
threads across audiences (HCI, education/learning sciences, CSCW/communication,
writing studies). Each one-pager is a candidate study; together they are the
*project the plan plans*.

Companion design note: `docs/my-words-interaction-design.md` (the interaction
framework these build on). Musing that generated these: the plan file for this
session.

---

## The shared idea, factored

A rubric is **shared common ground about what the document should be** — a
*boundary object* (Star & Griesemer 1989) between the writer's intent and the
agent's model of quality. Every proposal manipulates one of three moves:

1. **Authorship** — where criteria come from (writer-led · agent-proposes · co-constructed)
2. **Assessment** — how/when the agent judges the draft (on-demand · live · walkthrough)
3. **Structure of talk** — how notes are organized (threaded-under-todo · flat+links · rubric-is-surface)

...overlaid on the **commitment / locus-of-control axis** inherited from the
my-words prototype (who holds the pen — and now, who holds the goal).

```
                 THE DESIGN SPACE

  authorship        assessment        structure of talk
  ┌───────────┐     ┌───────────┐     ┌───────────────┐
  │ writer    │     │ on-demand │     │ chronological │
  │ agent     │     │ live      │     │ goal-indexed  │
  │ co-constr │     │ walkthru  │     │ rubric-surface│
  └───────────┘     └───────────┘     └───────────────┘
        \________________ | ________________/
                          |
              overlaid on the commitment axis
        writer holds ●───────────────● agent holds
        (propose / gate)      (walkthrough / act-then-react)
        ...for WORDS (edits)  AND for GOALS (criteria)
```

## Two testbeds

- **Production add-in (main frontend).** Rubric as a persisted `ContextSection`
  in `DocContext.contextData` (already injected into every prompt); assessment
  reuses the Revise page's per-item streaming. Best for on-demand assessment,
  longitudinal study logging (`/api/log`), classroom-ish tasks.
- **my-words branch.** Rubric as another move through the `Responder` /
  `InteractionStrategy` seam; the word-bank constraint makes the *content-vs-direction*
  questions (P4, P5) uniquely askable. Best for tight, turn-level interaction studies.

---

## Thread map

| # | Proposal | Core manipulation | Primary hypothesis | Audience | Testbed |
|---|----------|-------------------|--------------------|----------|---------|
| P1 | Co-construction vs. handed-down | *how* the rubric is authored | negotiating criteria → deeper internalization & meaning-level revision | Education / learning sciences | main FE |
| P2 | Verdict as oracle vs. claim | *how* assessments are shown | evidence+uncertainty → better *appropriate reliance* on a fallible judge | HCI (trust / XAI) | either |
| P3 | Goal-indexed vs. chronological | *how* talk is organized | goal-indexing raises revision *altitude* (global vs. local) | CSCW / communication / writing studies | main FE |
| P4 | Locus of commitment for goals | *who commits* a criterion, when | people want more control over *goals* than over *words* | HCI (mixed-initiative) | my-words |
| P5 | Content withheld, direction shared | share words? × share goals? (2×2) | sharing *direction* not *words* preserves voice while gaining quality | HCI / communication (authorship & voice) | my-words |

Each lives in its own file (`P1-…md` … `P5-…md`).

## Threads kept as follow-ons, not full pages

- **Fading scaffold + self-assessment calibration.** Does rubric support that
  *withdraws* across sessions produce better unaided goal-setting and tighter
  writer/expert calibration (Sadler 1989; Zimmerman)? Strong, but longitudinal —
  a natural *second-year* study once P1/P2 establish the single-session effects.
  Pairs with P1 (same population, delayed unaided post-test).

## Threads that didn't hold up (and why)

- **LLM-as-judge reliability benchmark.** Real and important, but it's an *NLP
  evaluation* (dataset + inter-rater reliability), not an interaction study —
  wrong instrument for this project. We *consume* its finding (judges are
  fallible) as the premise of P2 rather than re-run it.
- **"Optimal number of criteria."** Parametric tuning with low theoretical
  payoff; better handled as a design default than a study.
- **"Does the rubric make the agent a better editor?"** Too confounded (rubric
  changes prompt, UI, and writer behavior at once) to yield a clean claim.

---

## How this becomes the project

1. **Instrument first.** A shared rubric + assessment data model and event
   logging (`Criterion`, `Rubric`, `EvaluationResult`; `rubric_created`,
   `criterion_assessed`, verdict-accepted/rejected). This is the measurement
   backbone every study reuses.
2. **P2 as the anchor study** (cheapest, most portable, hottest DV) validates the
   assessment layer.
3. **P1 and P4** fork on the *authorship* layer (one per testbed).
4. **P3** rides on whichever assessment UI P2 settles.
5. **P5** and the fading study are the ambitious, signature follow-ons.

Coding schemes reused across studies: **Faigley & Witte (1981)** revision
taxonomy (surface ↔ meaning), ownership/agency scales, appropriate-reliance
(accept-correct / reject-incorrect verdicts), and voice measures for P5.
