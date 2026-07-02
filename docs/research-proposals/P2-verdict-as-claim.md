# P2 — Verdict as oracle vs. claim (assessing against a fallible judge)

**Audience:** HCI (trust in automation, explainable AI). **Testbed:** either.
**One-line:** If the agent's "criterion met ✓" is sometimes wrong, how do we show
it so writers catch the errors instead of rubber-stamping them?

## Concept

The agent evaluates the draft against each criterion. But the judge is fallible:
LLM-as-judge has documented biases (verbosity, self-preference, position) and
Automated Essay Scoring has a construct-validity history — surface features
standing in for quality. So a verdict is not an oracle; it's a **claim** that can
be wrong. We manipulate how it's *presented*:

- **Oracle** — a bare label per criterion (met / partial / unmet).
- **Claim** — label **+ evidence** (the passage, highlighted, Toulmin's *data*)
  **+ uncertainty** (calibrated confidence) **+ a one-line warrant**.
- **Forcing** — the claim, but the writer must record *their own* judgment
  *before* the agent's verdict is revealed (Buçinca et al. 2021 cognitive forcing).

To measure *appropriate reliance* we seed a known fraction of **incorrect
verdicts** and observe whether writers accept the correct ones and reject the
wrong ones (Lee & See 2004; Parasuraman & Riley 1997).

```
              A VERDICT, THREE WAYS

  ORACLE            CLAIM                       FORCING
  ┌──────────┐      ┌────────────────────────┐  ┌───────────────────┐
  │ ✓ met    │      │ ~ partial  (conf .55)  │  │ you first:        │
  │ ~ partial│      │ "…evidence…" ◄highlight │  │  met? partial? �… │
  │ ✗ unmet  │      │ warrant: names no data  │  │  ─────────────    │
  └──────────┘      │ [Agree] [Disagree]      │  │ THEN agent's view │
   trust the label   └────────────────────────┘  └───────────────────┘
        │                    │                            │
   over-reliance?      scrutable claim            engagement, at a
   (accept wrong ✓)    (catch wrong ✓)            speed/effort cost
```

## Hypotheses

- **H1 (reliance).** Claim > Oracle on *appropriate reliance*: writers reject
  more seeded-wrong verdicts and accept more correct ones.
- **H2 (forcing trade).** Forcing > Claim on error-catching, but costs time and
  satisfaction.
- **H3 (over-trust).** Under Oracle, writers "fix" text an incorrect verdict
  flagged, and skip issues an incorrect ✓ approved.
- **H4 (calibration).** Confidence display improves writers' *own* calibration of
  which criteria are actually met.

## Design

Within-subjects over criteria, between-subjects over presentation (or fully
between to avoid learning). Seed ~25% wrong verdicts, balanced across met/unmet.
**Measures:** accept/reject vs. seeded ground truth (reliance), decision time,
trust scale, downstream expert-rated quality, and whether edits track *correct*
vs. *incorrect* flags. **Watch:** deception ethics (debrief about seeded errors);
confidence must be *calibrated* or it becomes noise.

## Two example interactions

**(A) Claim verdict — with a subtly wrong call**
> **Agent (criterion: "concrete evidence for each claim"):**
> ~ **Partial** · confidence 0.5
> Highlighted: *"our approach clearly outperforms prior methods."*
> Warrant: I read this as a claim without a number or citation beside it.
> **[Agree] [Disagree]**
> **Writer:** Disagree — the numbers are in the next sentence. *(catches it)*
> **Agent:** You're right — the figure two lines down is the evidence. Marking it
> **met**, and I'll widen how I look for evidence near a claim.

**(B) Forcing version — same criterion**
> **Agent:** Before I show you my read: does *"our approach clearly outperforms"*
> have concrete evidence attached? **[Yes] [Partly] [No]**
> **Writer:** Yes — number's right below.
> **Agent:** Agreed, now that I look at the following line. (Had you not looked,
> I'd have flagged it partial — good catch to check.)

## UX — the assessment card (wireframe)

```
 ┌───────────────────────────────────────────────────────────┐
 │ Criterion:  Concrete evidence for each claim              │
 │ ───────────────────────────────────────────────────────  │
 │  ~ PARTIAL          confidence ▓▓▓▓▓░░░░░ 0.5             │
 │                                                           │
 │  Evidence (in your draft):                                │
 │  ┌───────────────────────────────────────────────────┐   │
 │  │ "our approach clearly outperforms prior methods."  │◄──│ highlight
 │  └───────────────────────────────────────────────────┘   │ in document
 │  Why: a claim with no number or citation beside it.       │
 │                                                           │
 │        [ Agree ]      [ Disagree — here's why … ]         │
 └───────────────────────────────────────────────────────────┘
   FORCING variant: the label + confidence are blurred until the
   writer taps their own [Yes / Partly / No] first.
```

## Related work
Lee & See 2004 (trust in automation); Parasuraman & Riley 1997; Buçinca et al.
2021 (cognitive forcing functions); Toulmin (argument = claim/data/warrant);
LLM-as-judge bias literature; Automated Essay Scoring & construct validity
(Page; e-rater critiques); Amershi et al. 2019 (human-AI guidelines).
