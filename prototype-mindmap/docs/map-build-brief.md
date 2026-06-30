# Build brief — visual thought map (M2)

Handoff for an agent building the map UI cold. Read `src/types.ts`,
`src/controller.ts`, and `src/App.tsx` before starting.

## What this is

A reflective writing-thinking tool. The user authors every idea; the AI only
questions, mirrors the user's own words, and captures *confirmed* structure.
**Enforcement lives in code, calibration in config.** The headless loop (capture →
segment → signal-detect → readiness gate → mirror validate → user confirm) is
DONE and tested (52 tests). The unbuilt piece is the visual map: confirmed
thought units on a canvas the user freely arranges, groups, and connects.

## THE CENTRAL RULE — validation gates the AI, never the user

This is the most important thing in this document.

- **The map is the user's sovereign workspace.** No validator, readiness check,
  or gate ever BLOCKS a user action on the canvas. The user may create, title,
  regroup, move, connect, and edit freely. Their map is their work.
- **Every user action that introduces or changes wording writes back into the
  Source Bank** as a user utterance (`origin: "node_edit"` for edits to existing
  units; `origin: "declaration"` for new wording such as a fresh card or a
  connection phrase). This must feel seamless — the user never sees a "rejected"
  state on the map.
- **Validation/readiness gates remain ONLY on the AI side** — what the AI may
  mirror or assert in chat. Feeding the bank from the map simply gives the AI
  more grounded user words to work with. `processTurn` already reads
  `state.bank.getAll()` into `LLMContext.bank`, so anything the map adds to the
  shared `SourceBank` is automatically visible to the AI on the next turn.
- **"Confirmed with a mirror"** for a user-drawn connection = a seamless inline
  affirmation ("does this capture it?") that registers the edge + its wording
  into the bank. It is NOT a checkpoint that can reject the user's edge.

If a feature would let the AI *decide* structure, it's out of scope. If a feature
would let validation *block the user* on the map, it's wrong.

## One primitive: the card

Everything on the canvas is a **card**, and a card is a `ThoughtUnit`. There is
no separate "container" object.

- A **standalone card** = `role: "node"`, no `parentId`.
- A **node (group)** = a card with `role: "node"` that other cards point to via
  `parentId`. That parent card IS the node's **title**.
- **Member cards** inside a node = `role: "content"` or `"subnode"` with
  `parentId` = the title card. (`subnode` may itself have children → nesting.)
- A **connection label** = a card with `role: "connection_label"` attached to an
  edge.

Every structural move is therefore a re-parent + role change, both already
supported by `ThoughtUnit`. **No type changes required.**

| User does | Effect on the card |
| --- | --- |
| Pull a member out of a node | clear `parentId`, role → `"node"` |
| Drop a card into a node | `parentId` = title card, role → `"content"`/`"subnode"` |
| Swap a member to be the title | that card → `"node"`; old title + siblings re-parent under it |
| Move a card to another node | `parentId` = new title card |

Every such move appends a `roleHistory` entry with `changedBy: "user"`.

## Current state you build on

- `@xyflow/react` (^12) is a dependency, currently UNUSED. Use it for the canvas.
- `src/App.tsx` holds `confirmed: ConfirmedReflection[]` and appends to it in
  `decideClaim(...)` when a chunk is confirmed. That array is your input feed.
  The right-hand `.confirmed-panel` currently renders it as a flat list — the map
  REPLACES that panel (keep the list behind a debug toggle).
- The draft is a floating, draggable, minimizable panel (`position: fixed`); the
  chat is the fixed left column. The map lives in the center/right canvas region.
- Types in `src/types.ts` — build to them, do not redefine:

```ts
type ThoughtUnitRole = "node" | "subnode" | "content" | "connection_label";

interface ThoughtUnit {
  id: string; text: string; role: ThoughtUnitRole; parentId?: string;
  source: { reflectionId?: string; utteranceIds: string[];
            createdBy: "user" | "ai_from_reflection" };
  roleHistory: { role: ThoughtUnitRole;
                 changedBy: "user" | "ai_proposed_user_confirmed"; at: number }[];
}

interface ConfirmedReflection {
  id: string; text: string; candidateId: string;
  target: "idea" | "hierarchy" | "connection";
  sourceUtteranceIds: string[]; confirmedAt: number;
}

type UtteranceOrigin = "chat" | "node_edit" | "declaration";  // map writes the last two
```

- **CRITICAL INTEGRATION — thread the SAME bank instance into the map layer.**
  The map and the loop MUST share the one `SourceBank` created in `createState()`
  and held in a `useRef` (`stateRef.current.bank`) in `App.tsx`. The map writes
  user wording via `stateRef.current.bank.add(text, origin)` on that exact
  instance. If the map constructs or receives a *different* `SourceBank`, the
  failure is silent: the user's map edits never enter `LLMContext.bank`, the AI
  stays unaware of everything done on the canvas, and grounding silently drifts —
  with no error and no failing test unless you write one. Pass the instance down
  explicitly (prop or context); do not let a second bank exist. This is the
  single most likely thing to get wrong in this build.

## Scope — three slices

### M2a — Confirmed units appear on the canvas (do first)
- New `src/map-store.ts`: `ThoughtUnitStore` (mirror `CandidateStore` style in
  `src/store.ts`) — `add`, `get`, `getAll`, `update`, `delete`, `setRole`,
  `setParent`, plus xyflow node positions.
- When a chunk is confirmed, create one **standalone card** from the
  `ConfirmedReflection`, shown on the canvas **as is**: `createdBy:
  "ai_from_reflection"`, `reflectionId` set, `utteranceIds` = `sourceUtteranceIds`,
  initial `role: "node"` (everything starts standalone; grouping is the user's
  job), initial `roleHistory` entry.
- New `src/Map.tsx` with `@xyflow/react`: one node per card, **freely draggable
  from the start**, positions persisted in the store. Provenance visible on hover
  (source utterances / reflection id).
- Replace the confirmed-list panel with the map (debug list behind a toggle).

### M2b — User builds structure (the ownership surface)
- **Grouping / titles / cards**: implement the re-parent table above via drag.
  Clear affordances for pull-out vs drop-into vs reorder. Title = the node's
  parent card; any member can be swapped to become it.
- **Direct text edit**: editing a card's text writes a new SourceBank utterance
  (`origin: "node_edit"`), appended to `source.utteranceIds`; keep `reflectionId`.
- **Connections (inline, seamless, never blocked)**: user draws an edge between
  two cards (xyflow `onConnect`) and provides their wording for the relationship.
  Flow:
  1. The wording is written to the Source Bank (`origin: "declaration"`) — new
     wording is fine; it just becomes part of the user's words.
  2. An **inline** affirmation appears on the pending edge ("does this capture
     it?"). On confirm, the edge persists with a `connection_label` card.
  3. This is registration, not gating — the user is never prevented from making
     the connection. The point is that the AI now sees the relationship in the
     bank.
  Keep parent/child nesting and labeled connections as TWO distinct relationship
  kinds (`parentId` vs an edge) — do not collapse them.

### M2c — Canvas-aware questioning (NOT AI-proposes)

**The AI never proposes or draws structure on the map.** An earlier draft had the
AI surface pending edges / "nest under X?" proposals for the user to approve. That
was cut: a proposal-to-approve shifts the user from *generating* a connection to
*accepting* one (the generate→approve collapse; the influence/over-acceptance
risk). A canvas proposal is also either redundant (if grounded, it's already a
chat mirror) or a violation (if not grounded, the AI invented it). So structure
reaches the canvas only two ways, each confirmed EXACTLY ONCE at its origin:

1. **Chat-mirrored-and-confirmed** → the user confirmed it in chat (existing
   loop); it **renders on the canvas as already established**. No re-confirm.
2. **User-drawn** (M2b) → confirmed **once, inline on the canvas**.

Instead, the AI becomes **aware** of the canvas so its existing question mode can
ask sharper questions that push the user to articulate structure themselves:

- Organize-intent questions may reference map state — e.g. two standalone cards:
  "how do [card A] and [card B] relate?" The user answers in their own words →
  gated mirror → user confirms → connection appears.
- **Awareness only.** Seeing the map lets the AI *ask*; it never lets the AI
  *place*. No dashed proposals, no AI-drawn edges, no "approve this structure".

#### Think ↔ map balance + user slider

This builds on the EXISTING `questionIntent: "deepen" | "organize"` already in
`src/api.ts` / `src/config.ts`. `deepen` = wrestle/externalize (**the priority**);
`organize` = move toward structure/connections (map-building).

- **Priority is always getting the user to think.** The balance defaults toward
  `deepen`; `organize` is the lighter touch. This is the floor even at the
  map-leaning end of the slider.
- Add a **user-facing slider** ("Help me think  ←→  Help me build the map") that
  biases intent selection: lean-think RAISES the organize thresholds (stay in
  deepen longer); lean-map LOWERS them (organize sooner). Reuse
  `organizeIntentCandidateThreshold` / `organizeIntentReadyThreshold` — make them
  runtime-adjustable from the slider.
- **Three hard guardrails on the slider:**
  1. It only shifts question *framing*. Even at full "build the map," the AI still
     only *asks* — questions stay questions, never proposals.
  2. It NEVER loosens a grounding gate (validator / readiness / span-grounding).
     It is the first *user-facing* calibration knob; users tune their own
     experience, never the grounding.
  3. Thinking stays primary — the default leans `deepen`.

Touch points (this modifies the EXISTING chat loop, not only the map): the
`systemPrompt` intent logic in `src/api.ts`, the organize thresholds in
`src/config.ts` (runtime-driven by the slider), and the slider control in
`src/App.tsx`. It is coupled to canvas-aware questioning (the AI must see the map
to ask about it), so build them together.

## Decisions (resolved — don't re-litigate)
1. **Map replaces the confirmed list** (debug list behind a toggle).
2. **Free node drag from M2a**; positions persisted.
3. **Connection confirmation is inline on the canvas**, reusing the mirror idea
   as a seamless affirmation — not a chat round-trip, not a hard gate.
4. **User-introduced wording is allowed and added to the bank** (`node_edit` /
   `declaration`); validation never blocks the user, it only keeps the AI aware.
5. **Parent/child nesting ≠ labeled connection** — two relationship kinds.
6. **The AI never places structure on the map.** Structure arrives only via
   chat-mirror-confirmed or user-drawn. The AI's canvas role is *questioning
   only* (awareness, not placement).
7. **Think↔map slider** controls deepen/organize bias only; default leans
   deepen; never loosens a gate; never enables proposals.
8. Naming: labeled, user-elicited connections make this technically a *concept
   map*; keep UI copy consistent.

9. **Model stays `gpt-5.4-mini` for now.** Recent evals show the failures were
   coordination/prompt/controller issues, not model-capability failures. Revisit
   a model upgrade only if failures are judgment failures: repeated redundant
   questions after clear answers, bad mirrors of compound ideas, or failure to
   mirror after the user has answered a focused follow-up.

## Evaluation rubric for map-building cadence

Grade the coach against the design philosophy, not against "mirror everything
immediately." A map-ready idea should reach a mirror within about **one
productive turn** when the user is in a map-building posture, especially with
the slider at full map.

- **Full pass:** a compact, user-authored idea is mirrored immediately, or a
  compound/contrastive idea receives one focused question and then mirrors on
  the next clear user answer.
- **Failure:** the coach asks repeated narrowing/deepening questions after the
  user has clearly answered, loses the idea, or never presents a mirror path.
- **Not a failure by itself:** one useful follow-up question that helps the user
  state a cleaner, more confirmable card before mirroring.

Treat explicit declarations such as "the main idea is", "a second idea is",
"another idea is", "the next point is", or "I also want to show" as
**carry-forward pressure, not a command**. If the declared idea is compact and
source-groundable, the coach should mirror. If it is compound or contrastive,
one focused question is allowed, but the next clear answer should mirror.

## Acceptance criteria
- Confirming a mirror chunk puts exactly one standalone card on the canvas,
  traceable to its reflection + source utterances.
- The user can freely drag cards, title/regroup them (pull-out, drop-into, swap
  title, move between nodes), and draw inline-confirmed labeled connections.
- **No user action on the map is ever blocked by validation.** (Philosophical
  pass/fail.)
- Every user action that introduces/changes wording writes a SourceBank utterance
  (`node_edit`/`declaration`) into the shared bank, so the next chat turn's
  `LLMContext.bank` includes it.
- AI-side gates (validator, readiness) are unchanged; the map only feeds the bank
  and renders structure the user authored (chat-confirmed or user-drawn).
- **The AI never places a node or edge on the map.** Every structural element is
  traceable to a chat-mirror-confirmation or a user canvas action. (Philosophical
  pass/fail.)
- The think↔map slider changes only deepen/organize question framing; with the
  slider at full "map," the AI still only asks questions and never proposes or
  draws structure, and no grounding gate is loosened.
- A user wording change on the map (`node_edit`/`declaration`) is visible in the
  SAME bank the loop reads: assert `state.bank.getAll()` contains the new
  utterance after the map action — proving one shared instance, not two.
- `npx tsc --noEmit` clean; existing 52 tests stay green; add `map-store` tests:
  creation-from-reflection, re-parent + roleHistory, title swap, connection
  registration writes to bank, and the shared-bank visibility check above.

## Gotchas
- Never gate the user; the validator stays on the AI side only.
- One primitive (the card / `ThoughtUnit`); node = group, title = parent card.
- The integration seam is the **shared `SourceBank`** — the map must call
  `bank.add(...)` on the same instance the loop uses, or the AI won't see edits.
- `App.tsx` uses CSS-in-a-`<style>`-tag; match that, no new CSS framework.
- Respect the draft panel's `position: fixed` / z-index; the map is canvas-layer.
- Keep one source of truth for confirmed text; reference reflection ids, don't
  deep-copy mutable text that can drift.
