# Reader Contrasts

*Design sketch, September 2026.*

Verifiable support in the guardrail sense: findings the writer can trust because
an independent process produced them and the process's noise floor has been
measured. Not verifiable in the RLVR sense; there is no deterministic metric for
writing quality and this sketch does not pretend to one.

## Claim

The tool cannot verify writing quality. It can verify what a context-controlled
reader extracts from the document, and how that extraction changes when context
or text is removed. Those differences are findings the writer can trust exactly
as far as the noise floor has been measured, and no further.

## Rules

1. Readers answer questions. They never opine. Answer formats: a quoted span,
   one of N options, one sentence, or "not stated".
2. The tool reports comparisons, never answers. Raw answers sit behind a toggle.
3. Agreement is silence. Only differences get screen space.
4. No personas. Readers vary only in the manipulated variable.
5. A difference is reported only if it beats the null contrast (below).
6. The writer decides whether a difference is a problem. The tool gathers
   evidence; it does not grade (covenant 2 in `interface-concepts.md`).

## Questions

Three defaults, always asked:

- **Q1** What is the writer's main claim? (one sentence)
- **Q2** Who is this written for? (one sentence, or "not stated")
- **Q3** What does the writer want the reader to do or believe afterwards?
  (one sentence, or "not stated")

The writer may add questions; each needs an answer format. Expected answers (a
*key*) are optional. A key enables match findings. Contrast findings need no key,
so the no-key case is the base case, not a degraded one.

## Contrasts

| Contrast | Arms | Finding it can produce | Judgment left to the writer |
|---|---|---|---|
| Null | reseed; swap model family | noise floor `d₀` | none; never shown |
| Panel split | N readers, one arm | "Q1: 3 readers say X, 2 say Y" | is that ambiguity deliberate? |
| Key match | readers vs the writer's key | "5/5 readers gave X; you said Y" | did you mean X? |
| Brief | with the brief vs without | "with the brief, X; without, Y" | does the real reader know what the brief says? |
| Leave-one-out | full text vs text minus paragraph *k* | "removing ¶4 changes no answer" / "removing ¶2 flips Q1" | is ¶4 doing work these questions can't see? |

The brief contrast is the sharpest one available today: the brief already exists
(`docBriefContext`), it is facts about the rhetorical situation rather than
instructions, and a document that only reads as intended *with* it is depending
on context the reader may not have.

## Reporting rule

Let `d` be the fraction of paired samples whose bucketed answers differ. Report
a contrast only when `d − d₀` exceeds a margin, and prefer extreme splits: with
five samples per arm, report 5–0 and 4–1, never 3–2. The margin is a parameter
to fit on the calibration corpus, not to guess.

Free-text answers are bucketed by one equivalence judge. Its error is part of
`d₀`, because the null arm runs through the same bucketing.

## Cost

`calls = questions × samples × arms`. Defaults: 3 questions × 5 samples ×
(base + null + no-brief + *P* paragraphs). For *P* = 8 that is 165 short calls
per run. Acceptable on demand at a pause; not on every keystroke. Leave-one-out
becomes opt-in above roughly ten paragraphs, or switches to sections as the unit.

## What it does not do

No scores. No rewriting. No "the skeptical reader thinks". Nothing runs during
composition; the writer asks for a run at a pause.

## Where it sits

- A `lab` page via `frontend/src/pages/registry.tsx`.
- Generation through `src/api/generate.ts`. The brief through `useDocBrief` and
  `formatDocBriefForPrompt`; when that returns null the brief contrast is
  unavailable and the page says so rather than running it against nothing.
- Every answer, arm, and bucketing decision logged through the backend's study
  logging, so panel verdicts can later be compared with human readers. That
  comparison is the only thing that makes "trust" more than a word here.

## Cheapest honest test

An offline script, no UI. Take a corpus of consented study drafts. Measure `d₀`
per model and per answer format. Then measure `d` for the brief contrast. If
`d(brief) ≈ d₀` across the corpus, the brief contrast is not a finding and the
design shrinks to panel split plus leave-one-out. Build the page only after the
numbers say there is signal.

## Risks

- **Model reader ≠ human reader.** A low `d₀` says the panel is stable, not that
  it is right. Human calibration is required before any of this is a guardrail.
- **FAQ-ification.** Writers optimize the document for Q1–Q3. The questions
  target the reader's take-away rather than the text's surface, which helps, but
  this is a real Goodhart risk and should be watched in the study logs.
- **Key burden.** If writers will not write keys, only contrast findings remain.
  Acceptable; that is why the no-key case is the base case.
- **APIs are not deterministic** at temperature 0. The null arm measures this
  instead of assuming it away.

## Meta: this document, subjected to its own process

**Key**, for a reader who has not seen the conversation that produced this:

- Q1: The tool can't verify quality, but it can verify what a controlled reader
  extracts and what that extraction is sensitive to, provided the noise floor is
  measured first.
- Q2: The maintainers of this repo, deciding whether to build a lab page.
- Q3: Run the offline null-versus-brief measurement before building any UI.

**Leave-one-section-out**, done by hand while drafting. Sections cut because
dropping them changed no key answer:

- A "principles versus the covenant" section. Rules 3 and 6 carry it.
- An "alternatives considered" section on persona swarms and LLM-judge scoring.
  It would have been the slop this document argues against.

Kept although it changes no key answer: "Where it sits". Q3's ask is only
credible if integration is cheap, and that is a judgment, which is the writer's
job, not the panel's.

**Not done:** no independent readers have run on this document. The key above
is there so that someone can. If a fresh reader's Q3 comes back as "build the
lab page", this document has failed on its own terms and should be revised, not
defended.
