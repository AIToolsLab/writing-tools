# P3 — Goal-indexed vs. chronological discussion

**Audience:** CSCW / communication / writing studies. **Testbed:** main frontend.
**One-line:** Does organizing the conversation *by criterion* (instead of by
time) change the altitude at which people revise?

## Concept

Hold the rubric and the assessments constant; vary only how the discussion and
notes are **organized**. In the **chronological** condition, talk is a linear
chat (the current design). In the **goal-indexed** condition, every utterance,
verdict, and note files under the criterion it concerns — an IBIS-style structure
(Kunz & Rittel) where criteria are the *issues* and the back-and-forth are
*positions/arguments*.

External-cognition theory (Scaife & Rogers; Hutchins) says the representation is
not neutral: a goal-indexed view keeps the rhetorical whole in view and should
pull revision *upward* (toward structure and meaning), while a chronological view
keeps the writer in the local, most-recent edit. The predicted cost is
fragmentation — losing the holistic "feel" of the piece.

```
   CHRONOLOGICAL                     GOAL-INDEXED (IBIS)

   ▸ 10:02 you: "fix intro?"         ▼ Clear thesis up front      [~ partial]
   ▸ 10:02 ai: moved line up            ├ ai: thesis is buried in ¶2
   ▸ 10:03 you: "evidence?"             ├ you: "move it up?"
   ▸ 10:03 ai: ~ partial, ¶4            └ note: try leading with the stakes
   ▸ 10:05 you: "tone"               ▼ Concrete evidence          [~ partial]
   ▸ …                                  ├ ai: ¶4 claim unbacked
   time-ordered; the whole             └ you: "cite the pilot"
   is never in one place            ▼ Not boilerplate            [✓ met]
                                        └ ai: opening names the lab specifically
   revision stays LOCAL              revision goes GLOBAL (per-issue coverage)
```

## Hypotheses

- **H1 (altitude).** Goal-indexed → higher proportion of global/structural
  revisions; chronological → more local/surface edits (Faigley & Witte).
- **H2 (coverage vs. coherence).** Goal-indexed → better criteria coverage
  (fewer neglected todos) but *lower* self-reported "sense of the whole."
- **H3 (orientation cost).** Chronological is faster to *follow in the moment*;
  goal-indexed is faster to *answer "where do we stand?"*

## Design

Within-subjects with two comparable prompts, counterbalanced order and
representation (or between-subjects to avoid spillover). **Measures:** revision
altitude coding, criteria-coverage count, coherence ratings (blind), a
"sense-of-the-whole" retrospective, navigation/scan telemetry, and time to answer
a planted "which criteria still need work?" probe. **Watch:** the goal-indexed UI
is objectively more structured — match visual density so we test *organization*,
not polish; some talk is cross-cutting (belongs to no single criterion) — provide
an "unfiled/general" lane so that content isn't forced or lost.

## Two example interactions

**(A) Same exchange, chronological**
> **You:** the evidence feels thin
> **Agent:** In ¶4, *"clearly the best option"* has no support next to it —
> want to bring the pilot number up beside it?
> **You:** yes. also the intro is slow.
> **Agent:** Moved the thesis sentence to the top of ¶1.
> *(Two different criteria, interleaved by time; neither is "closed.")*

**(B) Same exchange, goal-indexed** *(writer clicks the "Concrete evidence" todo)*
> **▼ Concrete evidence — ~ partial**
> **Agent:** ¶4's *"clearly the best option"* stands alone.
> **You:** bring the pilot number up beside it.
> **Agent:** Done — marking this **met**. 3 of 5 criteria now met; *Clear thesis*
> and *Concise* still open.
> *(The writer sees the criterion move to done and what remains, in one place.)*

## UX — side-by-side wireframe

```
  CHRONOLOGICAL                    GOAL-INDEXED
  ┌───────────────────────┐       ┌───────────────────────┐
  │ ● you: …              │       │ RUBRIC        3/5 met  │
  │ ○ agent: …            │       │ ▸ ✓ Not boilerplate    │
  │ ● you: …              │       │ ▾ ~ Concrete evidence  │
  │ ○ agent: …            │       │    ○ agent: ¶4 unbacked│
  │ ● you: …              │       │    ● you: cite pilot   │
  │ ○ agent: …            │       │    [ add note ]        │
  │ …                     │       │ ▸ ~ Clear thesis       │
  │───────────────────────│       │ ▸ ✗ Concise            │
  │ [ say something…    ⏎ ]│       │ ▸   (general / unfiled)│
  └───────────────────────┘       └───────────────────────┘
   one stream, time-ordered        expand a todo → its thread
```

## Related work
Kunz & Rittel (IBIS); Conklin (gIBIS / Compendium); Rittel (wicked problems);
Scaife & Rogers (external cognition); Hutchins (distributed cognition); Faigley &
Witte 1981; threaded-vs-linear discourse in CMC/CSCW.
