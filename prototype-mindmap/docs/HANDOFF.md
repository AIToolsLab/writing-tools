# Handoff: Remaining Command-Safety / Command-Resolution Work In prototype-mindmap

## Context

- Repo branch: `feat/uist`
- Scope: `prototype-mindmap/`
- Do not work on unrelated frontend/chat/docs changes.

This project is a concept-map coaching prototype. The controller enforces hard
invariants around map mutations, mirror validation, command confirmation, and
grounding. The model can suggest responses, but code owns safety for commands
and map writes.

Recently landed fixes:

- deterministic explicit create-card commands
- deterministic explicit `#ref` connection commands
- blocking vague anaphoric placeholder cards
- label-decline handling
- stale two-cycle question guard
- multi-sentence exact-text create-card payloads
- **block negated exact-text card commands** (fixed — see below)
- **anchor card-coverage questions instead of stale settle wording** (fixed — see below)

---

## Bug 1: Negated Exact-Text Card Command Still Executes — FIXED

Status: **Fixed** on `feat/uist` (commit `c376006`).

### Symptom

A user could negate an exact-text card command, but the controller still
created the card if the payload spanned multiple sentence segments.

Example that should not create a card:

```
Do not create a card with exactly this text: AI is risky. It removes agency.
```

Same class:

```
Don't make a card with this exact text: AI is risky. It removes agency.
```

### Root cause

The multi-segment exact-text path `explicitExactTextCardCommand(...)` checked
for uncertain/question framing (`hasUncertainCommandFrame`) before the marker,
but did not check the negation helper (`isNegatedImperativePrefix`) that the
normal per-unit command parser already applies.

### Fix

Inside `explicitExactTextCardCommand(...)`, run the negation guard before the
uncertain-frame guard, before `cleanExplicitCardText(...)`:

```ts
if (isNegatedImperativePrefix(trimmed, match.index)) return undefined;
if (hasUncertainCommandFrame(trimmed, match.index)) return undefined;
```

Only the command frame before the exact-text marker is inspected — never the
payload. The payload may legitimately be a question (`Is AI risky? It might
remove agency.`).

Regression tests added near the existing exact-text command tests.

---

## Bug 2: Same-Turn "this" Card Command Fails — TODO

### Symptom

This user turn did not create a card:

```
Different style of AI use that enables user to be in more control.
make this a card
```

Actual behavior:

```
Let's zoom out a little — what's one small piece of this you feel sure about?
```

Expected behavior — create one card with exact text:

```
Different style of AI use that enables user to be in more control.
```

### Likely cause

The deterministic create-card parser handles direct payload commands like:

- `Make a card for X`
- `Create a card with exactly this text: X`
- `Put X on the map`
- `Turn X into a card`

But it does not resolve **same-turn anaphora** where the command sentence points
back to an immediately preceding sentence in the **same user message**:

```
X.
make this a card
```

The existing anaphora caution is good for prior-turn or vague cases like
`make the earlier authorial choices idea into a card`. **Do not loosen those.**

### Required fix

Add a narrow deterministic same-turn resolver:

> If a user turn contains multiple segments and the final segment is a clear
> card command using `this` or `that`, then create a card from the immediately
> preceding non-command segment.

Supported examples:

```
X. make this a card
X. turn this into a card
X. make that a card
X. add this to the map
X. put this on the map
```

Constraints:

- Only resolve within the same user turn.
- Antecedent must be the immediately preceding non-command segment.
- Do not resolve `earlier`, `previous`, `above`, or prior-turn references.
- Do not use draft text.
- Do not use map text.
- Do not create a card if the antecedent is vague/referential
  (e.g. `that idea`, `my main point`).
- Preserve exact antecedent wording, including terminal punctuation if present.
- Mark both the antecedent segment and command segment as command-only, so the
  command wording does not enter mirror context.

### Tests to add (controller loop tests)

Same-turn `this` command:

```
Different style of AI use that enables user to be in more control.
make this a card
```

```ts
expect(out.mapCommands).toEqual([
  {
    kind: "create_card",
    text: "Different style of AI use that enables user to be in more control.",
    sourceUtteranceIds: ["u_1"],
  },
]);
```

Same-turn `turn this into a card`:

```
Human control stays with the writer.
turn this into a card
```

Expected card text: `Human control stays with the writer.`

Same-turn map phrasing:

```
AI should ask questions before suggesting wording.
put this on the map
```

Expected card text: `AI should ask questions before suggesting wording.`

Do not resolve prior-turn `this`:

- Turn 1: `Human control stays with the writer.`
- Turn 2: `make this a card`

```ts
expect(out.mapCommands).toBeUndefined();
```

Do not resolve vague antecedent:

```
that idea.
make this a card
```

```ts
expect(out.mapCommands).toBeUndefined();
```

### Important

This is **not** a broad anaphora feature. It is only a safe same-turn shorthand:

```
[exact card wording]
[make this a card]
```

Keep broader "earlier X idea" behavior on the clarification path.

---

## Bug 3: Card-Coverage Question Gets Stale Generic Response — FIXED

Status: **Fixed** on `feat/uist`. Deterministic coverage-focus path added to the
controller with four regression tests. Details below describe the shipped fix.

Priority: **High for demo feel.** This is a stale-question / ignored-user-intent
bug, not a map-corruption bug, but it is very visible.

### Symptom

After a card is created, the user asks:

```
is there any major point in this the current card (46) doesnt cover? Or at least that I need to think about
```

Actual coach response:

```
Which focused point for this section feels easiest to name first?
```

Then the user says:

```
not sure
```

Actual coach response:

```
Let's zoom out a little — what's one small piece of this you feel sure about?
```

### Why this is buggy

The user is no longer asking "which focused point should I name first?" They are
asking a map/draft **coverage** question:

- Does card #46 cover the major point?
- Is anything missing?
- What should they think about next relative to this card and draft section?

The coach repeated stale generic "settle" wording instead of staying anchored to
the active concern.

This is **not** covered by the prior stale-question fix, which catches a narrow
two-cycle of exact carry-forward phrasings. This case is different: the
model/controller falls back to stale settle wording even though the user
introduced a **new map-evaluation intent**.

### Required fix direction

Add a narrow recognition path for card coverage / missing-point questions.

Detect when the user asks whether an existing card covers the section / draft /
point, especially with card refs. Examples:

```
does #46 cover the main point?
is there anything this card doesn't cover?
is there any major point in the current card (#46) doesn't cover?
what am I missing from this card?
does this card cover this section?
what else do I need to think about for #46?
```

Expected coach behavior:

- Do not create a card.
- Do not mirror.
- Do not repeat old carry-forward / settle question.
- Ask a coverage-anchored question about the card and draft section.

Acceptable responses:

```
What part of the draft section feels least represented by #46?
```

or:

```
Looking at #46, which part feels least covered: the interface/product point, the authorship/control point, or something else?
```

Be careful with the second example: **do not invent options** unless they are
grounded in visible draft/card context. Safer default is the first form.

### Handling `not sure`

If the user then says `not sure` while the active concern is coverage /
missing-point evaluation, the coach should stay anchored to that concern.

Bad:

```
Let's zoom out a little — what's one small piece of this you feel sure about?
```

Better:

```
What phrase or sentence in the draft feels least connected to #46?
```

or:

```
Which part of the draft are you checking #46 against first?
```

### Implementation suggestion

Keep this narrow and deterministic.

- Add a lightweight detector for coverage/evaluation intent:
  - card refs: `#\d+`
  - words like `cover`, `missing`, `doesn't cover`, `major point`,
    `current card`, `this card`, `need to think about`
  - optionally `section`, `draft`, `point`
- Store a small active state, e.g.:

  ```ts
  coverageFocus?: {
    cardRef?: string;
  }
  ```

  or reuse an existing focus mechanism if one already fits.
- When coverage intent is detected, return a question like:
  `What part of the draft section feels least represented by #46?`
- If `coverageFocus` is active and the user says `not sure`, ask:
  `Which sentence in the draft are you checking #46 against first?`
- Clear `coverageFocus` when:
  - the user issues a direct map command
  - the user moves on
  - the user answers with a substantive card/draft comparison
  - clear-chat / clear-map paths reset controller state

### Tests to add (loop/controller tests)

**Test 1 — coverage question with card ref.** Setup map with one card:
`#46 — Different style of AI use that enables user to be in more control.`

User:

```
is there any major point in this the current card (#46) doesnt cover? Or at least that I need to think about
```

```ts
expect(out.mapCommands).toBeUndefined();
expect(out.mode).toBe("question");
expect(out.text).toContain("#46");
expect(out.text).toMatch(/draft|section|least represented|checking/i);
```

Do not assert exact text too tightly unless needed.

**Test 2 — does not repeat stale previous question.** Before the coverage
question, set the prior AI text to
`Which focused point for this section feels easiest to name first?`, then ask
the coverage question.

```ts
expect(out.text).not.toBe("Which focused point for this section feels easiest to name first?");
```

**Test 3 — `not sure` stays anchored to coverage.** After Test 1 establishes
coverage focus, user says `not sure`.

```ts
expect(out.mode).toBe("clarify"); // or "question"
expect(out.text).toMatch(/#46|draft|section|sentence|checking|represented/i);
expect(out.text).not.toBe("Let's zoom out a little — what's one small piece of this you feel sure about?");
```

**Test 4 — no card/mirror mutation.** For the coverage question and the
`not sure` follow-up:

```ts
expect(out.mapCommands).toBeUndefined();
expect(out.validatedMirror).toBeUndefined();
```

### Non-goals

- Do not build a broad "draft evaluator."
- Do not have the AI answer the coverage question by inventing missing points.
- Do not harvest draft content into cards.
- Do not create multiple suggested cards.
- Do not make broad philosophical changes to whether the app should evaluate the
  draft. The safe behavior is to ask a grounded comparison question, not answer
  for the user.

---

## Verification

Run from `prototype-mindmap/`:

```
npm.cmd test -- --run src/loop.test.ts
npx.cmd tsc --noEmit
```

If those pass, run full verification:

```
npm.cmd test -- --run
npm.cmd run build
```

## Commit

After green verification, commit and push to `feat/uist`.

Suggested commit messages:

```
mindmap: resolve same-turn "this" card commands
mindmap: anchor coverage questions instead of stale settle wording
```
