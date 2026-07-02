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

Suggested commit message for Bug 2:

```
mindmap: resolve same-turn "this" card commands
```
