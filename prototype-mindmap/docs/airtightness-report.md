# Airtightness Report — Reflective Mind-Map Prototype

How the product's philosophy is enforced, which file owns each constraint, and
where enforcement is **code** (airtight) vs **prompt** (soft / defense-in-depth).
Covers `prototype-mindmap/` as of the M1 + airtightness-fix pass. Tests: 44/44.

**Central principle:** the user authors every idea, hierarchy, and connection.
The AI questions, reflects the user's *own words* back, and captures confirmed
structure — it never authors, decides, or polishes. Enforcement that matters
lives in **code**; prompts only add a second layer.

---

## 1. Constraint → file → mechanism (code-enforced, airtight)

| # | Constraint (philosophy) | File(s) | Mechanism |
|---|---|---|---|
| 1 | A reflection must be made of the user's words | `validator.ts` (`checkLexicalGrounding`) | Broad overlap ≥ 0.8 of content words trace to bank (stemmed) **and** additions ≤ 0.15. Both parts must pass. |
| 2 | Relationships/hierarchy must come from the user, not be invented | `validator.ts` (`checkSpanGrounding`) | Every claim span must be grounded in cited utterances; for hierarchy/connection, one span must carry the user's relational/containment wording **and** be grounded in a *single* utterance. |
| 3 | The readiness gate cannot be gamed by the LLM | `controller.ts` (step 5), `signals.ts`, `readiness.ts` | Relation signals + spontaneity are **code-derived** from `detectSignals` (scored against the AI's previous turn), never taken from the LLM. Evidence ids validated against the bank. |
| 4 | A hierarchy needs *spontaneous* user containment language | `readiness.ts` (`requireSpontaneousForHierarchy`) | Hard rule: a hierarchy candidate is never ready unless ≥1 containment signal is spontaneous. |
| 5 | The AI cannot commit structure; only the user confirms, per chunk | `controller.ts` (returns `validatedMirror`), `App.tsx` (per-claim confirm) | A passing mirror is only *proposed*; each claim is confirmed/declined independently; only confirmed claims become `ConfirmedReflection`. |
| 6 | No unvalidated AI prose may appear as a reflection | `controller.ts` (`MIRROR_PREAMBLE`) | On a passing mirror the user-facing text is a fixed preamble; the LLM's free prose is discarded. The reflection is the validated claims only. |
| 7 | Fail closed: a blocked mirror becomes a clarify question, never a reworded retry | `controller.ts` (mirror-fail branch) | On validation failure the controller switches to clarify mode targeted at the validator's `weakestSpan`. The LLM cannot retry for smoother wording. |
| 8 | A stuck user is never mirrored and never "moved on" from | `controller.ts` (step 5.5, `isStuck`) | If the utterance contains stuck language, the turn is forced to clarify in code regardless of the LLM's intended mode. |
| 9 | Mirror only at the right pace (build as you go, no dump, no grind) | `controller.ts` (pacing check), `config.ts` (`pacing`) | A mirror proposed before `minQuestionTurnsBetweenMirrors` is downgraded to a question. |
| 10 | Only ready candidates may be mirrored | `controller.ts` (readiness gate), `readiness.ts` | Mirror claims are filtered to post-update ready candidate ids before validation; unknown/not-ready candidateIds are dropped (fail-closed). |
| 11 | Malformed/oversized LLM output cannot break enforcement | `api.ts` (`parseTurn`, `chatJSON`) | Invalid JSON → defaults to question; claims missing id/text filtered; unknown modes coerced to question. |
| 12 | The Source Bank is ground truth: append-only, all user words | `store.ts` (`SourceBank`) | Every user utterance (incl. future node edits) is recorded with id/origin; never edited by the AI. |
| 13 | Candidates are evidence, never shown raw as decisions | `store.ts` (`CandidateStore`), `App.tsx` | Candidate store is internal; the UI shows only confirmed reflections. |
| 14 | Calibration is separable from enforcement | `config.ts` | All thresholds/weights/pacing live here; enforcement logic does not hard-code them. |

---

## 2. Light code detail per enforcement

**Lexical grounding (`validator.ts`).** Content tokens = non-stopword tokens.
`broad_overlap = owned/content` where *owned* = stem present in the bank;
`additions = (content − owned)/content`. The check returns both as `parts`; it
passes only if `broad_overlap ≥ lexicalBroadMin` **and** `additions ≤ lexicalAdditionsMax`.

**Relationship binding (`validator.ts`).** For `target` hierarchy/connection,
`phraseHasTerm(userPhrase, terms)` (whole-word match against `CONTAINMENT_TERMS`
/ `RELATION_TERMS`) must be true for some span, and `spanGroundedInSingleUtterance`
must confirm that span's content words appear in *one* cited utterance ≥
`spanGroundingMin`. Otherwise `span_grounding.ok = false` and `weakestSpan` points
at the relational gap.

**Code-derived signals (`controller.ts` step 5).** `detectSignals(uttId, text,
lastAiText)` runs deterministically; each detected signal's `spontaneous` flag is
`true` only if the term did **not** appear in the AI's previous turn. Signals are
attached to a candidate only when that candidate's (bank-validated) evidence ids
include the current utterance. LLM-supplied signals are not part of the contract.

**Readiness (`readiness.ts`).** `sourceDensity` (target-aware: ideas scored on
evidence repetition; relational targets blend evidence + weighted signals, where
spontaneous=1.0, prompted=0.5), `relationClarity`, `unsupportedRisk`. A candidate
is ready only if all thresholds pass and the hierarchy spontaneity rule holds.

**Stuck override (`controller.ts` step 5.5).** `isStuck` matches a phrase list
("i'm not sure", "i don't know", "i'm stuck", …). When true the turn returns
clarify; if the LLM tried to mirror, its text is replaced with a concrete
re-angle fallback.

**Per-chunk confirmation (`App.tsx`).** Each claim renders with confirm/decline;
`decideClaim` adds only confirmed claims to the `ConfirmedReflection` list.

---

## 3. Prompt-level enforcement (soft layer — `api.ts`)

These shape behavior but are **not** guaranteed by code. They are defense-in-depth
on top of the code gates, or cover areas with no code gate (question quality).

- **Non-negotiable rules block** (`PHILOSOPHY`): never invent ideas/relationships;
  a mirror reflects structure, never a transcript replay; use the user's words for
  every content term; every claim carries `sourceSpans`; never use the word "node";
  never lead a question with an embedded answer; on stuck, ask a tighter concrete
  question and never move on.
- **Dynamic constraint notes** injected each turn: pacing note ("you MUST use
  question this turn"), readiness note (which candidate ids may be mirrored),
  clarify override (the exact ungrounded span to probe), stuck note, detected-signal
  note (which utterance to group so signals land correctly).
- **Question-mode rules**: ask one question; make it structure-inducing
  (hierarchy / detail / connection); never a vague rephrase ("how does that shape
  your thinking?"); never repeat the same question structure.
- **Mirror-mode rules**: per-target text templates ("[bigger thing] [user's
  containment phrase] [smaller thing]"); copy `userPhrase` verbatim; echoes the
  validator constraints so the model self-checks before emitting.
- **Output contract**: structured JSON; the model proposes only grouping
  (gist/target/evidence), never signals or spontaneity.

---

## 4. Residual soft areas / known limits (document these)

- **Question content quality is prompt-only.** There is no code gate on whether a
  question is genuinely open or structure-inducing. A leading question is possible
  if the model misbehaves.
- **Signal & relationship detection is keyword-based** (`signals.ts` term lists).
  It under-detects novel phrasings. Under-detection is *safe* (it blocks a mirror
  rather than leaking), but means some legitimate relationships need rephrasing.
- **Stemmer is a crude stub** (`normalize.ts`), not real lemmatization.
- **Signal attribution follows LLM grouping.** Spontaneity and the words are
  code-owned, but the LLM decides which candidate an utterance supports, so a real
  signal could be attached to the wrong candidate. Bounded (the words are still the
  user's), but not eliminated.
- **No structure feedback loop yet (M2).** `ConfirmedReflection`s render in a panel
  but don't become graph thought-units or inform later questions; rejected claims
  don't yet trigger targeted re-questioning.

---

## 5. File responsibility summary

| File | Responsibility |
|---|---|
| `validator.ts` | Lexical grounding + span/relationship grounding. The core gate. |
| `readiness.ts` | Whether a candidate may be mirrored (incl. hierarchy hard rule). |
| `signals.ts` | Deterministic containment/relation detection + spontaneity. |
| `controller.ts` | Orchestration: code-derived signals, gating, pacing, fail-closed clarify, stuck override, mirror preamble. |
| `store.ts` | Source Bank (ground truth) + Candidate Store (internal evidence). |
| `config.ts` | All calibration values (no enforcement logic). |
| `api.ts` | Real LLM client + prompt construction (soft layer) + defensive parsing. |
| `App.tsx` | Per-chunk confirmation; shows only confirmed reflections. |
| `types.ts` | Domain model incl. provenance + thought-unit role history. |
