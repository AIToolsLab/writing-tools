# Multilingual Grounding Pass — spec for Codex

Status: AGREED 2026-07-23. Amendments from Claude review are folded in and marked
**[AMENDED]**. Read `DESIGN.md` and `airtightness-report.md` first; nothing here
relaxes the authorship invariants.

## Central design decision

Multilingualism changes how the coach **understands and presents** original
evidence; it does **not** create a second authoritative version of that evidence.
Natural mirrors remain the default, exact wording becomes a repair strategy, and
provenance — not translation — continues to determine what the system may claim
or place on the map.

Three separate concepts, never conflated:

- **UI locale** — buttons, labels, instructions, fixed interface copy.
- **Original authored content** — user messages, drafts, cards, evidence,
  relationship wording. Stored exactly as authored; authoritative.
- **AI translation** — an explicitly requested, visibly attributed model output.
  Never silently replaces authoritative content.

Do **not** create an authoritative translated SourceBank or insert translated
duplicates into the SourceBank.

## 0. Donor branch: `origin/feat/mindmap_translation` — cherry-pick, never merge

**[AMENDED — verified rationale]** The translation branch forked **before** the
Stage 1 typed-proposal cutover. It still carries `stage1-loop.ts`-era code, an
old `validator.ts`, controller-era modules, and ~24k insertions vs. main. A
merge would resurrect deliberately deleted subsystems. Treat it strictly as a
donor: copy files/assets in, never `git merge` it.

**[AMENDED — the donor is better than first assessed.]** Inspect before
rebuilding; these donor modules already encode the right philosophy:

Reuse (near) as-is:
- `src/i18n/*.json` — **34 static UI dictionaries including `zh.json`**, keyed
  by English source string. Chinese UI works day one.
- `src/ui-strings.ts` — static dictionary lookup with case-folded keys;
  partial dictionary degrades in coverage, never correctness.
- `src/language.ts` — the write/view language split. Its own doc comment states
  a view-language translation is "never written back, never harvested into the
  map, and never handed to the assistant as the writer's wording."
  `isReadOnlyView()` is a genuine **seed for the centralized mutation guard**
  (checkpoint 1), not something to discard.
- `src/translate.ts` / `src/translation-memory.ts` /
  `src/translation-context.ts` — display-only translation overlay with
  client-side caching and bounded concurrency; never mutates stored content.
- Locale controls, persistence keys (where compatible), reader-display styling,
  UI-presentation-only tests, `useSpeechToText` if wanted (separate decision).

Reimplement or substantially revise (anything touching the pre-cutover runtime):
- Any derived translation bank treated as authored content.
- Any logic that translates SourceBank entries.
- Coach context construction (rebuild on the current typed loop).
- Grounding and normalization (rebuild per §5 on the current `validator.ts`).
- Persistence that treats translated text as authored.
- Scattered mutation/read-only checks → centralize (checkpoint 1).
- Anything referencing the donor's old `validator.ts`, loop, or controller.

## 1. Branch and checkpoint strategy

Create a new branch from the current authoritative branch:

```
mindmap-main HEAD
└── feat/mindmap-multilingual-grounding
```

Before importing anything: confirm TypeScript, tests, and build are green; add
regression tests for existing provenance and assistance-level boundaries;
record the starting commit in the handoff. Do not merge the remote language
branch.

Checkpoints, in order:

1. UI localization + centralized mutation gating.
2. Original-language coach context and persistence.
3. **English/Chinese/mixed-language grounding** (see §5 amendment).
4. Explicit translation behavior.
5. Context budgeting, evals, and browser verification.

**[AMENDED — checkpoint discipline]** Each checkpoint must land independently
green (`tsc`, full Vitest, build) before the next begins — a regression must be
attributable to display localization vs. grounding vs. translation behavior
without untangling a combined diff. Checkpoints 1 and 5 are each PR-sized
tracks on their own; do not fold them into neighbors.

## 2. UI localization without touching authored content

Port from the donor: locale selection, translated application chrome,
translation dictionaries, persisted UI locale, localized fixed recovery and
progress UI, localized accessibility labels.

Never translate or overwrite: SourceBank utterances, user chat messages,
drafts, card contents, candidate evidence, relationship evidence,
model-history entries. A display-language change re-skins the interface and
leaves all authored material **byte-for-byte unchanged**.

While doing this, centralize read-only and mutation permissions: every map or
proposal mutation passes through one authoritative guard (seeded from the
donor's `isReadOnlyView` pattern), covering direct card creation/editing, "Add
as card", proposal confirmation/editing, nesting and connections, candidate
restoration/dismissal, and assistance-level continuation actions.

**[STATUS 2026-07-23]** Checkpoints 1–3 are accepted on
`feat/mindmap-multilingual-grounding` (rebased onto `mindmap-main`;
checkpoint 1 `7448891`, checkpoint 2 `47e2999`, checkpoint 3 reviewed and
awaiting its commit). Reviews, audit findings, and carry-forward items live
in `AGENT-HANDOFF.md` under this pass's collision-map entry. Checkpoint 4
(§8 explicit translation) is next; it makes `translated_view` reachable and
therefore also owns the checkpoint-1 carry-forwards: gateway-level read-only
enforcement + user-visible rejection feedback, and the
`source.json`/`zh.json` "Enter to send" dedupe. Standing invariants:
grounding never consults `latestUserLanguagePattern` (advisory-invariant
test pins it), and the English mirror-rate watch-item in §6 applies before
any validator loosening is even discussed.

## 3. Original multilingual coach context

The coach receives original user content, not derived translations. Add:

```ts
interface LanguageContext {
  uiLocale: string;
  preferredCoachLanguage?: string;
  latestUserLanguagePattern?: "single" | "mixed" | "unknown";
}
```

These are conversational hints, **not evidence**. Prompt guidance
(approximately): preserve authored passages in their original language; respond
using the language pattern of the latest user turn unless asked otherwise; a
mixed-language turn may receive a naturally mixed-language response; do not
silently translate quoted evidence. Incorrect language detection must never
invalidate or alter user content.

## 4. Reflections cite precise evidence phrases

Preserve natural model-authored reflections; code never assembles them. Extend
reflection evidence so the model identifies the phrases inside cited
utterances:

```ts
interface ReflectionEvidencePhrase {
  utteranceId: string;
  userPhrase: string;
}

interface GroundedReflection {
  text: string;
  evidence: ReflectionEvidencePhrase[];
}
```

Code: (1) confirm the utterance exists and is eligible; (2) confirm
`userPhrase` occurs in that exact original utterance; (3) locate internal
character positions itself; (4) validate the reflection against selected
evidence phrases; (5) validate relationships separately; (6) commit advisory
mutations only after the complete response passes. **Never** ask the model to
calculate character offsets (doubly important for CJK: surrogate pairs and
grapheme clusters make model-computed offsets unreliable).

## 5. Layered multilingual normalization

Separate language-neutral processing from language-specific equivalence. Do
not introduce semantic similarity or embedding-based validation — the
validator checks authorship support, not topical relatedness.

### Language-neutral foundation (all languages)

- Unicode canonical normalization;
- safe case comparison where applicable;
- whitespace normalization;
- Unicode-aware word segmentation;
- punctuation and quotation handling;
- exact phrase location.

**[AMENDED — CJK requirements for the neutral layer.]** As originally specced
this layer produces false grounding failures in Chinese. Required:

1. **Punctuation width/quote folding.** NFC does *not* unify full-width
   `，。！？：；` with half-width equivalents, nor `「」『』` with `“”`/`""`.
   The model quoting an utterance with different punctuation width must not
   fail exact-match. Fold via NFKC or an explicit width/quote-mapping table in
   the neutral normalizer. This is the single most likely Chinese-breaking
   omission — cover it with tests (see §10).
2. **Segmentation without whitespace.** "Unicode-aware word segmentation"
   means `Intl.Segmenter` with word granularity (handles zh). The Node test
   environment must have **full ICU** (verify; add a canary test asserting
   `new Intl.Segmenter("zh", {granularity:"word"})` segments a known sentence
   correctly), or repair-ladder "unsupported words" feedback is garbage for
   Chinese.
3. **Simplified ↔ Traditional is NOT unified.** If the model echoes evidence
   converting 简↔繁, it fails grounding and falls to the repair ladder. That is
   the *decided* behavior (safe fail), not an accident — document it in the
   validator and cover it with a test.

### Supported language profiles

**[AMENDED — initial profiles are English and Chinese, not English and
Spanish.]** The target audience is Chinese; the donor branch already ships
`zh.json`. Spanish may be added later as the inflectional-equivalence
exemplar; it is not in this pass's scope.

```ts
interface GroundingLanguageProfile {
  segment(text: string): string[];
  normalizeToken(token: string): string;
  isFunctionWord(token: string): boolean;
}
```

The **zh profile** is cheaper than an inflectional one:
- `segment`: `Intl.Segmenter("zh", { granularity: "word" })`.
- `normalizeToken`: identity plus the neutral layer's width/quote folding (no
  stemming — Chinese has no inflection).
- `isFunctionWord`: a small **closed** particle/glue list (e.g. 的 了 是 就 吗
  呢 也 和 在 着 过 呀 吧 啊). Keep it closed-class; no open-ended word bank
  (same principle as the no-hedging-word-bank rule in the mirror-faithfulness
  spec).

Without a zh profile, mixed zh-en turns would treat every particle as
substantive → stricter validation → more forced repairs → a stiffer coach in
exactly the demo language. The profile exists to permit *grammatical glue
only*; substantive terms still require exact evidence match.

### Mixed-language validation

- Preserve quoted and substantive phrases in their original language;
- apply a known profile only where appropriate;
- unknown substantive terms must match evidence exactly;
- permit only narrowly defined conversational glue;
- reject translated substantive claims unless the response is explicitly
  classified as translation.

Language detection can assist profile selection; it cannot determine
authorship or rewrite evidence.

## 6. Recovery stays model-owned

No deterministic exact-source response composer. When a natural reflection
fails grounding, use the existing capped ladder (see the graceful-recovery
spec in the handoff): informed repair receives the unsupported words and the
rejected reflection; the model may produce a corrected natural reflection, a
more extractive reflection preserving exact phrases, a question, or another
contract-allowed response; repeated failure reaches the existing
forced-question call. Prompt (not controller code) advises: if paraphrasing
cannot be grounded faithfully, preserve the user's exact original-language
wording; if that would be unnatural or misleading, ask one context-specific
question instead. Code decides validity; the model decides the conversational
move, except the already-agreed forced-question bound.

**[AMENDED — expected Chinese behavior shift, by design.]** Chinese
reflections paraphrase aggressively by nature (synonym swaps, aspect
particles, measure words), so exact-phrase grounding will fail more often in
Chinese than English, pushing the coach toward extractive mirrors and
questions. This is contract-correct but changes the demo *feel* — the Chinese
coach will sound more quote-heavy. Measure it (§10 evals) before a demo
audience does; if the first-pass grounded-mirror rate in Chinese is
materially worse than English, that is a prompt-tuning/model-capability
signal, not a reason to loosen validation.

Because Checkpoint 3 also limits lexical support to the exact evidence phrases
the model nominates, compare the English first-pass grounded-mirror rate against
the pre-Checkpoint-3 baseline. If it drops materially, tune the prompt to cite
enough precise original-language evidence; do not loosen the validator.

## 7. Cross-language relationships through provenance

Given `u1` (English: A), `u2` (Chinese: B), `u3` (Chinese: explicit
relationship between A and B), a response may cite:

```json
{
  "sourceEvidence":       { "utteranceId": "u1", "userPhrase": "A" },
  "targetEvidence":       { "utteranceId": "u2", "userPhrase": "B" },
  "relationshipEvidence": { "utteranceId": "u3", "userPhrase": "relationship wording" }
}
```

Source and target remain in their original languages; no translated copies.
Assistance levels unchanged: L0 requires the relationship supplied by the user
under the existing L0 temporal/evidence contract; L1 may select/juxtapose
earlier user material as `ai_connected`; L2 may propose a novel relationship
as visibly `ai_suggested`. Merely understanding two languages does not
authorize a relationship. If a cross-language reference is too implicit for
code to verify, L0 asks for clarification — it does not silently translate or
infer.

## 8. Translation as a separate response capability

An explicit translation request is not a mirror:

```ts
interface TranslationResponse {
  kind: "translation";
  sourceEvidence: ReflectionEvidencePhrase[];
  targetLanguage: string;
  translatedText: string;
  provenance: "ai_translated";
}
```

Product-oriented L0 may answer an explicit translation request provided it is
visibly labeled AI-translated; is not a grounded reflection; does not
automatically enter the SourceBank; does not become a card or relationship
without a separate user adoption action; does not replace the original in
model history. If the user later states or adopts the translated wording
through an explicit user action, that adoption creates new authoritative user
evidence — the translation itself remains AI-authored. Spontaneous translation
is generally avoided at all levels.

(The donor's `translate.ts`/`translation-memory.ts` display overlay is
compatible with this — it is a *view*, not a response. The `TranslationResponse`
kind governs the coach channel; the overlay governs the read-only reader view.)

### §8 product decisions — RATIFIED 2026-07-23

Checkpoint 4 ships as **two independently green slices**:

**4a — coach translation response (first).** Exactly the `TranslationResponse`
contract above. Decided:

- The request is **model-classified and schema-validated**. A direct
  natural-language ask in chat ("translate that for me" / "把这个翻译成英文")
  yields the labeled translation card. There is **no chat-side Translate
  button** — the model decides the conversational move, code decides
  validity, same as every other response kind. Misclassification is low-harm
  by construction: the response is conversational only, visibly labeled, and
  enters nothing. Add a Stage 4 precision scenario: a turn that *mentions*
  translation without requesting one must not yield a translation response.
- Adoption needs no new UI in this slice: the user typing/saying the
  translated wording themselves makes it authored. A dedicated "adopt this
  wording" affordance is deferred polish.

**4b — reader view (second).** Everything translated **including user
words**, therefore read-only (`translated_view` becomes reachable). The
visible language picker lives here — switching the whole screen is a mode
change and deserves a control; a per-utterance translation is a
conversational request and does not. Port the donor overlay. This slice owns
the two checkpoint-1 carry-forwards: gateway-level read-only enforcement +
user-visible rejection feedback, and the `source.json`/`zh.json`
"Enter to send" dedupe.

**Control Room in the translated view — RATIFIED 2026-07-23.** The Control
Room is a *mixed* surface; do not blanket-translate it. Split by layer:

- **Translate (it is chrome):** app-authored narration and labels — section
  titles ("What mattered this turn"), causal-event titles ("Idea is ready to
  reflect"), safety-check copy, buttons. Same category as the rest of the
  interface; a reader gets it in their language so the panel is not
  conspicuously untranslated.
- **Leave byte-for-byte (it is the audit layer, not presentation):** machine
  codes (`lexical_grounding`, `reflection_validation_failed`, …) are
  identifiers, not prose, and the honest-to-user / jargon-in-Control-Room
  split already puts raw technical truth here; **evidence snippets** are the
  writer's verbatim words shown *as proof* that an exact string grounded a
  claim — translating one falsifies the audit (it would assert the validator
  matched text it never saw) and violates the §8 rule that quoted user
  wording is never translated; payloads are the literal record likewise.

Rationale: reading surfaces (cards, chat, map, proposals) translate as
*presentation* for comprehension, kept honest by the read-only lock. The
Control Room's job is *fidelity*, not comprehension — the reader understands
the map through the translated cards, not through the Control Room, which is
the proof layer behind them. Proof you have translated is no longer proof.

**Deferred nicety (not v1):** where a reader needs the meaning of a raw
snippet, show a translation as a *gloss beside* the verbatim (tooltip /
subtext), never replacing it — the same "label it, don't launder it" pattern
as the `ai_translated` card.

**The read-only dividing line (philosophy, binding):** the lock follows
*whose words are displayed non-authoritatively*. Translating AI-authored
chrome or speech never requires a lock; the moment **user words** are
displayed in translation, the screen no longer shows the authoritative text
and every write path must refuse.

**Considered and REJECTED — do not re-propose without new user evidence:**

- A third "coach-language" mode (chrome + coach speech in a chosen language,
  user words untouched, editable). Unnecessary: the coach already follows
  the user's turn language natively (§3), so the normal screen is
  monolingual with zero translation; the niche write-in-X-coached-in-Y case
  is reachable via the conversational override, which the prompt already
  honors. That override does not persist across reloads — recurring user
  complaints about re-asking are the demand signal to wire the reserved
  `preferredCoachLanguage` picker; build it then, not now. Note that even
  then, quoted user evidence inside mirrors/recaps/verbatim options always
  displays in the user's original language — a translated mirror is exactly
  the masquerade this section forbids, and the §5 validator rejects it
  mechanically.
- **Back-translating historical coach messages** (rejected outright, not
  deferred): requires the runtime engine plus span-level care for embedded
  verbatim user evidence, and buys retroactive transcript consistency that
  human conversation does not have either. Switching languages mid-session
  leaves earlier turns in their original language, like any real
  conversation.

## 9. Bound model context without weakening validation

Do not send an indefinitely growing SourceBank every turn. Build the working
prompt from: the latest conversation turns; the complete latest user turn;
current user selection or draft focus; explicitly referenced cards; evidence
for active candidate memories; evidence for pending proposals; deliberately
recalled older evidence.

Store the complete SourceBank locally and validate every returned evidence
reference against it. For a very long utterance: retain the complete original
locally; include it while directly relevant and within budget; have the model
cite smaller exact phrases; never silently treat a truncated prompt fragment
as the complete utterance. Add diagnostics showing which SourceBank entries
were included, omitted, or truncated. No semantic retrieval in this slice.

## 10. Required tests

Deterministic coverage, at minimum:

- UI locale changes without authored-content mutation.
- Reload preserving original multilingual SourceBank entries byte-for-byte.
- English natural reflection validation.
- **[AMENDED]** Chinese natural reflection validation.
- **[AMENDED]** Mixed Chinese/English evidence in one utterance.
- Cross-language evidence across multiple utterances.
- Long utterances requiring precise evidence phrases.
- Evidence phrase absent from the claimed utterance.
- **[AMENDED]** Chinese→English (and reverse) paraphrase rejected as a mirror.
- **[AMENDED]** Full-/half-width punctuation and CJK-quote round-trip: model
  quotes evidence with different punctuation width → still grounds.
- **[AMENDED]** Simplified/Traditional mismatch fails grounding (the decided
  safe-fail behavior) and falls to the repair ladder.
- **[AMENDED]** `Intl.Segmenter` zh canary (full-ICU present in test env).
- Explicit translation accepted only as `ai_translated`.
- Translation excluded from SourceBank and map provenance.
- L0 cross-language unstated relationship rejection.
- L1 cross-language juxtaposition classified as `ai_connected`.
- L2 novel relationship classified as `ai_suggested`.
- Multilingual reflection repair → exact-wording reflection.
- Multilingual reflection repair → question.
- Existing maximum model-call guarantees hold.
- Mixed-language content surviving persistence and reload unchanged.
- Central read-only gating across every mutation path.
- Context budgeting retaining required evidence and reporting omissions.

**[AMENDED — evals]** The Stage 4 harness manipulation checks must run in
Chinese as well as English (at minimum: first-pass grounded-mirror rate,
recovery-stage distribution, terminal failures, per language). Spanish
scenarios are out of scope for this pass.
