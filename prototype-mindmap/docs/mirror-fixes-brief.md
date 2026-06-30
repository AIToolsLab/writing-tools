# Fix Brief — make the coach mirror *structure*, not the transcript

Hand-off for the chat that built the working UI coach. Context: a first test
showed the coach echoing the user's messages back verbatim as a "reflection"
instead of helping the user externalize the *structure* of their thinking. This
brief lists what to fix, in dependency order, and how it connects to the
enforcement core already built in `prototype-mindmap/`.

## The core problem

The coach echoes the transcript because **it has no structure to mirror.**
Everything else is downstream of that. Making the wording prettier without first
giving the mirror real structure to reflect just produces nicer echoes.

Observed failure mode = **100% lexical grounding, 0% structural externalization**:
the reflection replayed the four user messages as bullets (including "I am not
sure"), confirmed all-or-nothing. That is the degenerate case the design exists
to beat.

## Philosophy (the bar every fix must meet)

The user is the author of every idea, hierarchy, and connection. The AI is a
non-directive facilitator: it questions, reflects the user's *own words* back,
and captures confirmed structure. It never authors, decides, or polishes — not
even unconsciously. Enforcement lives in **code**, not prompt wording.

## Use the existing enforcement core — do not rebuild it

`prototype-mindmap/src/` already has a tested headless core (17 tests green):

- `validator.ts` — `validateMirror(reflection, bank, cfg)`. Two checks:
  - `lexical_grounding` (broad_overlap + additions parts) — is it the user's words?
  - `span_grounding` — does every claim trace to a user utterance that actually
    supports it? (Catches *relationships* invented from real words.)
- `readiness.ts` — `evaluateReadiness(candidate, bank, cfg)` — is a candidate
  ready to mirror yet? Spontaneous-vs-prompted weighting; hierarchies need a
  spontaneous containment signal.
- `signals.ts` — detects containment/relation language, flags spontaneous vs.
  prompted.
- `config.ts` — all thresholds/pacing in one place.

Wire these in behind the UI. Two chats are converging on one tool; this core is
the single enforcement layer. Don't harden a second validator.

## Fix order (dependencies matter)

**1. Add a candidate/structure layer between input and mirror.**
Don't send turns straight to a reflection. From each turn, maintain candidate
*ideas* and *relationships* (the test transcript had "creator vs. facilitator"
plus the principle "the user always stays the author"). Candidates are
LLM-maintained but never shown and never become structure without passing the
validator + user confirmation. Only mirror a candidate once
`evaluateReadiness` returns `attempt_mirror`. *Nothing else works without this.*

**2. Change the mirror from "replay messages" to "reflect structure," chunked.**
- Reflect relationships/hierarchy phenomenologically: *"it sounds like
  you-as-creator is the bigger thing, AI-as-facilitator sits under it, and 'I
  stay the author' is the principle connecting them — is that right?"* Never the
  word "node".
- **One structural claim per chunk, each independently confirmable.** Kill the
  all-or-nothing "Yes / Not quite". Accept one relationship, reject another.
- **Never put non-content in a reflection.** "I am not sure" is a stuck signal,
  not a thought unit — it must never appear as a confirmable item.

**3. Turn on validator gating AT THE SAME TIME as fix 2 — they are coupled.**
The moment the mirror is allowed to rephrase (vs. verbatim echo), the AI can
smuggle in its own ideas. Every mirror claim must carry `sourceSpans`
(utteranceIds + the user phrase) and pass `validateMirror`. On failure, do not
retry for smoother wording — fall back to a clarifying question on the weakest
span. Verbatim echo was only "safe" because it never transformed anything; once
you transform, the validator is what keeps it honest.

**4. Add real Clarify behavior for "I'm not sure" and validator failures.**
When the user is stuck or a mirror fails, re-angle or break the question down —
never just move on. In the test, abandoning "I am not sure" was the single
biggest coaching failure.

**5. Fix Question Mode — concrete and structure-inducing, not formulaic.**
The test repeated "How do you see X shaping Y?" three times. Replace with
questions that force articulation of hierarchy/detail/connection: *"what does
the facilitator role actually do?"*, *"how does 'I stay the author' connect to
'the AI never decides'?"* Ban abstract rephrase-questions and any leading
yes/no question that embeds an answer.

**6. Make it build as you go.**
The test did one big reflection at the end. Fire small structural mirrors
mid-conversation as candidates become ready (readiness + pacing in `config.ts`),
so the structure accumulates incrementally instead of in one dump.

## Acceptance criteria

- A reflection never reproduces the message list; it states relationships/
  hierarchy in the user's words.
- Non-content ("I'm not sure", "ok", questions) never appears as a confirmable
  chunk.
- Each chunk is confirmed/rejected independently.
- Every rephrased reflection passes `validateMirror`; failures route to Clarify,
  not to a reworded retry.
- "I'm not sure" produces a re-angled question, not a move-on.
- Mirrors fire incrementally during the conversation, not only at the end.

## Integration — how to call the core (exact signatures)

All exports are pure functions; no network, no state. Import from
`prototype-mindmap/src/`.

```ts
import { defaultConfig, type MindmapConfig } from "./config";
import { detectSignals, targetForSignals } from "./signals";
import { evaluateReadiness, readyCandidates } from "./readiness";
import { validateMirror } from "./validator";
import type {
  SourceUtterance,
  CandidateThought,
  RelationSignal,
  MirrorReflection,
  MirrorClaim,
  SourceSpan,
  ReadinessSignal,
  MirrorValidationResult,
} from "./types";
```

Signatures:

```ts
// signals.ts — detect structural language in a user turn.
detectSignals(utteranceId: string, userText: string, priorAiQuestion?: string): DetectedSignal[];
targetForSignals(signals: DetectedSignal[]): "idea" | "hierarchy" | "connection";
// DetectedSignal extends RelationSignal with { kind: "containment"|"relation"; term: string }
// spontaneous=false when the term echoed the AI's preceding question.

// readiness.ts — may this candidate be mirrored yet?
evaluateReadiness(candidate: CandidateThought, bank: SourceUtterance[], cfg: MindmapConfig): ReadinessSignal;
readyCandidates(candidates: CandidateThought[], bank: SourceUtterance[], cfg: MindmapConfig): ReadinessSignal[];
// ReadinessSignal.decision is "attempt_mirror" | "ask_clarifying_question"; .reason explains a block.

// validator.ts — gate a proposed mirror BEFORE showing it.
validateMirror(reflection: MirrorReflection, bank: SourceUtterance[], cfg: MindmapConfig): MirrorValidationResult;
// result.ok = all claims passed. result.claims[i].ok / .weakestSpan / .checks per chunk.
```

Key shapes (see `src/types.ts` for the full set):

```ts
interface SourceUtterance { id: string; text: string; timestamp: number;
  origin: "chat" | "node_edit" | "declaration" }

interface CandidateThought { id: string; target: "idea"|"hierarchy"|"connection";
  evidenceUtteranceIds: string[]; relationSignals: RelationSignal[]; gist: string }

interface SourceSpan { claimText: string; utteranceIds: string[]; userPhrase: string }
interface MirrorClaim { id: string; text: string; candidateId: string;
  target: "idea"|"hierarchy"|"connection"; sourceSpans: SourceSpan[] }
interface MirrorReflection { claims: MirrorClaim[] }
```

### One conversation turn, end to end

```ts
// 1. Record the user's message in the Source Bank.
const utt: SourceUtterance = { id, text: userText, timestamp: Date.now(), origin: "chat" };
bank.push(utt);

// 2. Detect structural language (pass the AI's previous question for spontaneity).
const signals = detectSignals(utt.id, userText, lastAiQuestion);

// 3. LLM updates candidate thoughts (gist + target + evidence). Never shown raw.
//    Merge `signals` into the matching candidate's relationSignals.

// 4. Which candidates are ready? Apply pacing (config) on top.
const ready = readyCandidates(candidates, bank, cfg);

// 5a. None ready -> Question Mode (or Clarify if a candidate is close/stuck).
// 5b. Ready -> LLM drafts a MirrorReflection: one MirrorClaim per ready candidate,
//     each with sourceSpans citing the user utterances + the user's own phrase.

const result = validateMirror(reflection, bank, cfg);
if (!result.ok) {
  // Do NOT reword and retry. Take the first failing claim's weakestSpan and
  // ask a targeted clarifying question about it.
} else {
  // Show passing claims as separate, independently confirmable chunks.
  // A confirmed chunk -> a ConfirmedReflection -> (later) a thought unit.
}
```

The LLM's job is to *propose* candidates and draft claims **with source spans**.
Code decides readiness and whether a claim may be shown. That division is the
whole guardrail.
