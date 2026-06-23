# Writing Coach with Hard Authorship Guardrails — Evaluation Log

**Prototype:** `prototype-uist/` (branch `feat/uist`)
**Status:** living document — exploratory evaluation during iterative development
**Last updated:** 2026-06-22

---

## 0. What this document is (and is not)

This is a running log of the **iterative, LLM-assisted exploratory evaluation** we
ran while building the coach. It captures, for each behavior: the reason we
tested it, the input, expected vs. actual, the result, and (where relevant) the
design change a failure triggered. The intended uses are:

1. shared reference for collaborators,
2. raw material for a UIST poster/paper evaluation narrative,
3. a seed for a future automated regression suite.

**Important methodological caveat.** The "tests" below were conducted by a large
language model (ChatGPT) role-playing a writer interacting with the coach, plus
the developer. They are **formative/developer testing, not a human-subjects
usability study.** They are valuable for surfacing failures and driving design
iteration, but they are **not** generalizable user-study results and should not be
presented as such. A UIST evaluation section will need a separate study with human
participants (see §6). Frame these as "iterative formative evaluation that shaped
the design," which is a legitimate and common UIST narrative.

---

## 1. System under test (one paragraph)

A writing tool whose thesis is: **AI helps the writer think, organize, and place
ideas, but the words that enter the document must be the writer's own.** The AI
acts as a Reflection coach, a Writing coach, and a Secretary. A hard guardrail
forbids inserting any text into the document that is not user-owned, approved
bank text. Layout: left chat+voice, center plain-text editor, right shared
word bank + placement tools.

Stimulus used throughout: a reflective essay on Ada vs. Java — compile-time vs.
runtime design, abstraction, flexibility, and efficiency trade-offs.

---

## 2. Evolution narrative (the "failures informed design" story)

This is the part most useful for a paper: the design was shaped by observed
failures, not authored top-down.

| Phase | Problem observed | Change made | Outcome |
|-------|------------------|-------------|---------|
| Baseline coach | Coach asked generic, shallow questions; felt like a chatbot. Secretary already felt novel. | Rewrote coaching half of the single model prompt; added `coachMode` (reflection/writing/placement) + draft-anchored `focusQuote`. | Reflection questions became sharp and document-aware. |
| Pending-bank visibility | During testing, pending extractions were buried/too tall to review — couldn't tell if extraction worked. | Reordered right panel; compact cards with edit-toggle; pending-count pill; chat-side banner; scrollable list. | Extraction became inspectable; unblocked further testing. |
| Writing/Placement weak | Placement questions stayed in writing mode; questions rarely anchored; loops. | Placement trigger on location questions; anti-loop rule; mandatory anchoring for writing/placement (with anti-fabrication fallback). | Placement triggering fixed; anchoring reliable; no fabricated quotes. |
| Validate-not-advance | Once an idea was developed, coach replied "that seems logical" with no question — conversational looping. | Mandatory-question rule + advance-don't-validate rule. | Coach advances the discussion; every reply ends in a question. |
| Robotic | After removing validation, every turn fired a question; felt mechanical. | Allowed occasional brief affirmation as a lead-in (never replacing the question, never paraphrasing). | Natural cadence, affirmation sparing. |
| Meta in bank | Essay-evaluation comments ("the ending feels weak") were extracted into the bank. | Extraction prompt excludes evaluative/process commentary. | Meta filtered; real content retained. |
| Placement disconnected (Phase A) | Coach talked about placement but user had to manually select+paste+click. | Added `placementCandidateText`; on placement turns auto-prime the suggest box + highlight, with notice. Prime-not-act; reuses validated insert path. | One-click-closer placement; insertion guardrail intact. |
| No-clobber | New placement turn overwrote an unresolved primed candidate. | "Newest auto-prime wins, but never overwrite user-typed text or an active suggestion" (tracked via `lastPrimedTextRef`). | Pivot case works; user input protected. |

---

## 3. Structured test catalog

Status legend: **PASS** / **FAIL** / **NOT TESTED** / **OPEN BUG** /
**HISTORICAL** (a failure we deliberately fixed; kept as a regression guard).

### Group A — Coaching mode selection
| ID | Purpose | Input (abbrev.) | Expected | Actual | Result | Screenshot |
|----|---------|-----------------|----------|--------|--------|-----------|
| A1 | Reflection recognized | "not sure yet… don't explain how my thinking changed" | reflection mode, reasoning question | "How does the trade-off… influence your overall argument?" | PASS | _TBD_ |
| A2 | Writing recognized | "conclusion should emphasize efficiency isn't the top goal" | writing mode | integration-into-conclusion question | PASS | _TBD_ |
| A3 | Placement recognized | "Ada section or conclusion?" | placement mode | reader-impact placement question | PASS | _TBD_ |

### Group B — Draft anchoring / highlights
| ID | Purpose | Expected | Actual | Result | Screenshot |
|----|---------|----------|--------|--------|-----------|
| B1 | Ada region anchored | highlight Ada paragraph | correct | PASS | _TBD_ |
| B2 | Java region anchored | highlight Java paragraph | correct | PASS | _TBD_ |
| B3 | Single stable highlight (no flicker) | one highlight | one highlight | PASS | _TBD_ |

### Group C — Authorship preservation
| ID | Purpose | Expected | Actual | Result |
|----|---------|----------|--------|--------|
| C1 | No fabricated quotes | references only draft/user text | no fabrication observed | PASS |
| C2 | Extraction source integrity | every pending item traceable to user input | all from chat/draft | PASS |

### Group D — Validation vs. advancement
| ID | Purpose | Input | Behavior | Result |
|----|---------|-------|----------|--------|
| D1 | Detect looping (original failure) | "trade-off belongs in the conclusion" | "That seems logical." (no advance) | HISTORICAL (fixed) |
| D2 | Mandatory question | — | every reply ends with a question | PASS |
| D3 | Advance not validate | "trade-off should appear before the conclusion" | "How could introducing it earlier change how readers interpret the Java discussion?" | PASS |

### Group E — Natural affirmation
| ID | Purpose | Expected | Actual | Result |
|----|---------|----------|--------|--------|
| E1 | Occasional affirmation | rare, short | "Interesting point —", "That's a useful distinction —" | PASS |
| E2 | No cheerleading | low frequency | sparing | PASS |
| E3 | Affirmation still advances | affirmation + question | observed consistently | PASS |

### Group F — Extraction filtering
| ID | Purpose | Input | Expected | Actual | Result |
|----|---------|-------|----------|--------|--------|
| F1 | Meta commentary filtered | "the ending feels weak" | not extracted | not extracted | PASS |
| F2 | Content preserved | "efficiency is not the only value in language design" | extracted | extracted | PASS |
| F3 | Evaluative comment filtered | "the strongest part is the Ada discussion" | not extracted | not extracted | PASS |

### Group G — Placement reasoning
| ID | Purpose | Result | Notes |
|----|---------|--------|-------|
| G1 | Placement conversation deepens | PASS | moved user from "where" → "why" → reader impact |
| G2 | Placement develops structural insight | PASS | user evolved to "this placement sets up the trade-off before Java" |

### Group H — Placement priming (Phase A)
| ID | Purpose | Expected | Actual | Result | Screenshot |
|----|---------|----------|--------|--------|-----------|
| H1 | Priming accuracy | correct approved item auto-fills box | exact match | PASS | _TBD_ |
| H2 | Verbatim preservation | exact bank wording | preserved | PASS | _TBD_ |
| H3 | Prime/highlight coordination | box text matches highlighted region | correct | PASS | _TBD_ |

### Group I — No-clobber protection
| ID | Purpose | Scenario | Expected | Actual | Result | Screenshot |
|----|---------|----------|----------|--------|--------|-----------|
| I1 | Auto→auto replace allowed | candidate A primed, user pivots to B | box updates to B | updated | PASS | _TBD_ |
| I2 | User-typed protected | user typed "MY CUSTOM TEST TEXT", new placement turn | not overwritten | preserved | PASS | _TBD_ |
| I3 | Active suggestion protected | suggestion active, new placement turn | not clobbered | preserved | PASS | _TBD_ |

### Group J — Graceful fallback
| ID | Purpose | Expected | Status | Priority |
|----|---------|----------|--------|----------|
| J1 | Placement idea not in approved bank | no auto-fill, no fabricated candidate, coach still responds | no auto-fill; no fabricated candidate; coach responded | PASS | _TBD_ |

### Group K — UI & workflow
| ID | Purpose | Expected | Actual | Result | Screenshot |
|----|---------|----------|--------|--------|-----------|
| K1 | Placement notice shown | notice appears | displayed | PASS | _TBD_ |
| K2 | "One click closer" UX | coach assists, user inserts | conversation → prime → ask → review → insert | PASS | _TBD_ |
| K3 | Placement suggestion card rendering | card fully visible/scrollable | fixed: word bank pinned, region below (pending/placement/rejected) scrolls in one area | PASS | _TBD_ |

---

## 4. Status & open items

**Phase A is fully verified — all groups PASS** (conversational placement logic,
priming accuracy, highlighting, no-clobber, graceful fallback J1, and card
rendering K3). No known conversational-placement blockers.

Resolved since first report:
- **J1 graceful fallback — PASS.** A placement question for an idea not in the approved bank produced no auto-fill and no fabricated candidate; coach still responded.
- **K3 placement-card clipping — PASS (fixed).** Right pane restructured: the word bank is pinned (`.bank-fixed`) and the region below it (pending / placement / rejected) scrolls in a single `.bank-scroll-area`, so the suggestion card can no longer be clipped.

Keep as regression guards: no-clobber (I1–I3) whenever placement code changes.

### Post-Phase-A UX backlog (polish, non-blocking)
Captured from the latest session; small UX items, not logic bugs:
1. **Placement pending indicator** — chat shows a banner for pending bank items but not for an awaiting placement suggestion; add a parallel "1 placement suggestion awaiting review" cue.
2. **Reduce vertical space above panes** — title + description push the three working panes down; trim/condense to give chat/draft/bank more room.
3. **Sticky "Suggest placement from the bank" header** — its section title scrolls away inside the new scroll area; keep the header visible while only its content scrolls.
4. **Status-bar discoverability** — bottom notices (e.g. "The coach is pointing at a spot…") are easy to miss; strengthen styling/emphasis when a notice changes.

---

### Group L — Phase B (expand / box authoring / keep-remove / abandon)
| ID | Purpose | Result | Notes |
|----|---------|--------|-------|
| L1 | Auto-prime after approval | PASS | approved item auto-fills box + re-highlights, no extra chat turn; verbatim preserved |
| L2 | Placement notification banner | PASS | "1 placement suggestion awaiting review" appears above chat |
| L3 | Box authoring | PASS | typing directly in the box works; inserts as user-owned text |
| L4 | Placement card clears after insert | PASS | card no longer lingers post-insertion |
| L5 | Insertion routing follows anchor | PASS (after fix) | **two bugs fixed in `document.ts` `findParagraphRangeForAnchor`**: (1) only recognized `\n\n` separators; (2) single global separator broke *mixed* drafts (single-newline body + blank line before Works Cited) — caused inserts to append before Works Cited + duplicate. Now uses next single `\n` boundary. Locked by 2 regression tests. |
| L6 | Keep/remove (tri-state) | NOT YET RE-TESTED | implemented; verify keep/remove/ask + persistence across reload |
| L7 | Abandon signal | NOT YET RE-TESTED | implemented; verify clears placement on stop/pivot, NOT on a plain reflection turn |

### Phase B follow-ups (non-blocking, for next session)
1. **Insertion spacing** — placement inserts as standalone paragraph blocks; after multiple inserts the draft accumulates extra blank lines. Decide whether inserted bank text should merge into surrounding prose or stay separate, and match the draft's existing newline style (`insertAsParagraph` in `document.ts`).
2. **Editor-mode controls audit** — Replace selection / Insert at cursor / Append / Replace placeholder radios may now be effectively dead for the coach-placement flow (insertion follows the coach anchor via `selectedSuggestion.target`, not `targetKind`). Confirm whether they still drive any manual path; if not, repurpose or remove.

## 5. Screenshot mapping (to fill during documentation pass)

Screenshots live in the user's local screenshot folder. A later pass should map
each file to the test ID it evidences. Replace each `_TBD_` above and fill this
index:

| Screenshot file | Test ID(s) | Caption draft |
|-----------------|-----------|---------------|
| _e.g._ Priming-Accuracy-01.png | H1, H2 | Approved bank item auto-primed verbatim into the suggest box |
| | | |

Suggested naming for new captures: `GroupID-ShortName-NN.png` (e.g. `H1-priming-accuracy-01.png`).

---

## 6. UIST relevance (grounded notes)

From the UIST author/poster guidance and formative-evaluation norms:

- **Poster track = a 2-page extended abstract (SIGCHI Papers format, PDF) + a
  ≤30×40 in poster.** The abstract states problem, contribution, and value; an
  optional ≤3-min video is encouraged. Posters are **not anonymous**. Don't
  double-submit the same work to Demos and Posters.
- **Screenshots are illustrative, not the evidence.** In a 2-page abstract you'll
  realistically have room for only a **handful of figures** — likely 1–3. So the
  vast majority of our captures will *not* appear in the abstract; their value is
  (a) on the physical poster, which has far more visual room, and (b) as backing
  evidence/appendix material for a fuller paper later. So: keep all screenshots,
  but expect only a few "hero" figures to make the abstract.
- **Strongest figure candidates** (most narrative payoff per inch):
  1. The three modes in action (reflection → writing → placement) — the core contribution.
  2. Word-bank extraction with the authorship guardrail (what makes it novel).
  3. The placement priming workflow: conversation → approved bank → candidate → highlight → suggestion.
  4. (Optional, strong for an honest paper) the placement-card bug as a "negative result / iterative design" beat — formative evaluation showing failures informed the interface.
- **Framing for credibility:** present the work below as **formative, iterative
  evaluation that shaped the design**, and position a human-subjects study as the
  evaluation. Formative testing with small N and qualitative, issue-based findings
  is well-accepted — but it is explicitly *not* the same as a summative user study.

### Recommended next step toward a real evaluation
A small human study (think-aloud, ~5–10 participants) measuring: do writers feel
ownership of the final text; does the coach advance thinking vs. merely capture;
task flow through reflect → bank → place; and perceived authorship. That produces
the generalizable evidence the formative log here cannot.

---

## 7. Change/version pointers
- Coach contract + prompt: `src/api.ts` (`coachAndExtractFromUserMessage`).
- Types: `src/types.ts` (`CoachMode`, `CoachExtractionResponse`, `placementCandidateText`).
- UI/state + priming + no-clobber: `src/App.tsx` (`handleSend`, `lastPrimedTextRef`).
- Protected pipeline (authorship guardrails): `src/bank.ts`, `src/document.ts` (`insertBankText`), `src/ownership.ts`.
- Planning notes incl. Phase B candidates: `~/.claude/plans/okay-create-a-plan-lively-kitten.md`.
