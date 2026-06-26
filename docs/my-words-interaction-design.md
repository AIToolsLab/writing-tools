# My Words — Interaction Design Note

**Status:** design exploration. Captures *why* the current My Words interaction
feels wrong and the direction to fix it. This is a design brief, not an
implementation diff — the implementation sketch at the end is a starting point,
not a spec to follow literally.

**Scope:** `frontend/src/pages/my-words/index.tsx` (the turn loop + `SYSTEM_PROMPT`)
and its tools. The word-bank corpus rules (`corpus.ts`, `validateText`) are not
in question here.

---

## 1. The problem (felt experience)

The My Words prototype uses a flagship model (GPT-5.5) but doesn't *feel* smart
or collaborative. Concretely, from using it:

- **Too much at once.** A single message produces a slab of edits; reading what
  changed becomes a *task*.
- **Had to stay vigilant.** Some reused material was wrong, and some text added
  in one place should really have been *moved* — but the only chance to catch
  that was after everything had landed.
- **Replies too long.** The spoken caption has to summarize a whole batch.
- **No awareness.** No sense, in the moment, of what the model was actually
  doing.
- **Not conversational or collaborative.** It performs work *at* you rather than
  *with* you.

## 2. Diagnosis: it's the control loop, not the model

The current turn is: one user message → one `generateText` with
`stopWhen: isStepCount(8)` → **up to eight tool steps run silently** (view,
str_replace, insert, highlight) → *then* `result.text` becomes the one caption
the writer sees. The model literally cannot speak until it has finished acting,
and the turn's tool results are dropped from history afterward (it re-reads the
doc cold next turn).

Almost every complaint falls out of that one choice:

| Symptom | Cause in the loop |
|---|---|
| Added too much at once | We *budget* up to 8 actions per turn |
| No awareness of what it's doing | Speech is the *last* step, after the work is done |
| Reply too long | The caption must summarize a batch, not narrate a move |
| Had to be vigilant / "should've moved that" | No checkpoint between moves; repair is only possible *after* 8 edits land |
| Doesn't feel collaborative | One floor-exchange per batch; the human never holds the floor *between* moves |

So the three usual suspects rank like this:

1. **The control loop (dominant).** Eight silent steps then one summary will make
   *any* model feel heavy-handed and opaque. The model's intelligence is spent in
   one burst, with no place for the human to stand inside it.
2. **Chat Completions vs Responses (secondary).** No persisted reasoning across
   turns, so the model can't remember *why* it made a move and can't gracefully
   course-correct. Real, but fix the loop first.
3. **The prescriptive dev message (third).** It spends most of its words policing
   the word-bank rule — which `validateText` already enforces in code — crowding
   out room for the model to be a responsive partner.

## 3. The reframe: what is a turn?

The fix is to stop treating a turn as "do a batch of work, then report" and
start treating it as a **single conversational move, then yield the floor**. One
edit, or one short utterance (optionally an edit *plus* a sentence) — then stop
and listen. This is the writing-conference rhythm the dev message already aspires
to, made real in the loop.

This isn't arbitrary; it re-derives well-studied interaction principles:

- **Grounding** (Clark & Brennan 1991; Clark, *Using Language* 1996). Every
  contribution has a *presentation* and an *acceptance* phase; partners build
  common ground incrementally, with evidence of understanding at each step, under
  *least collaborative effort*. The current design skips acceptance — it presents
  a finished slab. A writer's "ok" is a **backchannel / continuer**, not a turn —
  the theoretical license for one-move-then-yield.
- **Turn-taking** (Sacks, Schegloff & Jefferson 1974). Turns are built from
  *turn-construction units* with *transition-relevance places* where the floor
  passes. "One move per turn" = one TCU. **Adjacency pairs** explain why an edit
  should project a response slot.
- **Mixed-initiative** (Horvitz 1999, *Principles of Mixed-Initiative UIs*).
  Scale the granularity of agentic action to your uncertainty, and weigh the cost
  of acting vs. handing control back. Reusing prior material that "might be wrong"
  *is* acting under uncertainty → smaller move + a check, not a confident batch.
- **Workspace awareness** (Gutwin & Greenberg, CSCW). The missing sense of "what
  it's doing" is an awareness gap; *feedthrough* — seeing a partner's actions as
  they happen — is the fix. Interleaving a `speak` move with edits gives running
  feedthrough, and surfaces reasoning the Chat Completions API otherwise discards.
- **Repair** (Schegloff, Jefferson & Sacks 1977). Conversation prefers *early*
  and *self*-repair. The prototype pushes all repair onto the writer, *late*.
  A yield point after each move keeps repair cheap, while the move is easy to undo.
- **Revision strategy** (Sommers 1980). Novices revise by *addition*; experts by
  *restructuring — moving and cutting*. "That should've been moved" is exactly
  this: the tools and loop reward inserting. A real collaborator treats **move**
  and **cut** as first-class.
- **Minimalist tutoring / contingent scaffolding** (Brooks 1991; Wood, Bruner &
  Ross 1976). Give *only as much help as needed, then fade*. The case against
  "too much at once" is pedagogical, not just ergonomic.

## 4. Design decisions

### 4.1 One move per turn, via a `speak` tool

End the turn the moment the model makes **one** externally-visible move: a single
edit, or a `speak` (one or two sentences), optionally an edit *plus* a short
sentence. Not "8 steps then text." Prefer a `speak` *tool* over a returned list
of actions — a list re-batches (the model plans N moves up front, and we're back
where we started); a tool forces the model to commit to *this* move and
reconsider after seeing the writer's reaction.

### 4.2 Cheap, often-implicit acceptance — and **pre-load the next move**

Don't force a typed "ok": that violates least-collaborative-effort and becomes a
chore by the third edit. A continuer should be a single Enter/tap, and the
writer's *next substantive message or edit* should count as acceptance of the
last move. Reserve an explicit confirmation prompt only when the model is
genuinely uncertain (Horvitz: confirm in proportion to the cost of being wrong).

**Responsiveness refinement (important):** to keep one-move-per-turn from feeling
*slow*, the model should **name and pre-stage the move it intends next** as part
of yielding. So a move ends not just with a question but with a projected next
step — e.g. *"I'd move that line up to open the paragraph — want me to?"* The
continuer then accepts a *specific, already-formed* proposal, so on "ok" the next
move applies instantly instead of triggering a fresh think-from-scratch
round-trip.

This is double-grounded: it's an explicit adjacency pair (proposal → acceptance),
*and* it gives the responsiveness of speculative execution. Mechanically the
staged move is a *proposal in words*, not a pre-applied edit; the continuer
triggers application, which re-reads the live document (`view`) so a stale plan
can't clobber anything. "ok, ok, ok" becomes a chain of accepted micro-proposals
— a collaborator walking the writer through it — rather than one silent slab.

Open design question: how eagerly to pre-compute. Options range from "model just
*states* its next intended move in words (cheap, no extra inference)" to
"speculatively run the next step in the background so application is instant." Start
with the former; only add background speculation if the round-trip still feels slow.

### 4.3 Keep history management simple

Earlier iterations over-engineered the context plumbing (per-turn activity notes,
3-line post-edit "describe the change" windows, bundling the scratchpad into
`view`, deltas of deltas). Collapse it:

- **`view()` returns just the document** — numbered paragraphs, nothing else.
  The scratchpad is not bundled into it.
- **Scratchpad changes are pushed as just the new text** — a lightweight note
  with the delta when it changes, not re-fetched through `view`.
- Drop the elaborate `buildActivityNote` / `describeChange` machinery in favor of
  the smallest signal that works. After an edit, a plain confirmation is fine; the
  model re-`view`s when it needs current paragraph numbers.
- Keep the durable transcript to the writer's turns and the model's spoken moves.

The rule of thumb: the document is the source of truth, `view` is cheap, so don't
hoard or pre-chew state in the prompt.

### 4.4 Loosen the dev message in the same change

Rules the harness already enforces in code (the word-bank constraint) don't belong
in the prompt — they crowd out the room the model needs to *be* a partner. Tell it
the **stance** ("one small move, then listen; name what you'd do next") and let
`validateText` be the cop.

### 4.5 Responses API — a separate experiment

Worth doing for persisted reasoning, but change the loop *first*. Doing both at
once means we won't know which fixed it, and the loop is the bigger lever.

## 5. Implementation sketch (not binding)

- Replace `stopWhen: isStepCount(8)` with a loop that stops after the **first**
  visible move (one edit, or one `speak`). Add a `speak` tool whose argument is
  the short utterance; the turn ends when it's called (or when a single edit
  lands).
- The model's move includes a **projected next step** in its utterance. Track that
  projection so a continuer (`""` / "ok" / Enter) maps to "carry out what you just
  proposed," re-validating against the live doc on apply.
- Add **move** and **cut** as first-class operations (or make `insert` honestly
  able to relocate existing text), so restructuring isn't forced through
  add-then-delete.
- Simplify `view` to document-only; push scratchpad deltas as plain text; delete
  `buildActivityNote` / `describeChange` and the dropped-tool-results bookkeeping.
- Trim `SYSTEM_PROMPT` to stance, not rules.

## 6. Open questions

- How eager should next-move pre-loading be (stated-in-words vs. background
  speculation)? See §4.2.
- When the writer's reaction invalidates a staged move, does the model silently
  re-plan or surface the conflict? (Repair: probably surface it briefly.)
- Does **move/cut** need writer confirmation more often than **insert**, given
  its higher cost of being wrong? (Mixed-initiative says likely yes.)

## References

- Clark, H. H. & Brennan, S. E. (1991). *Grounding in Communication.*
- Clark, H. H. (1996). *Using Language.*
- Sacks, Schegloff & Jefferson (1974). *A Simplest Systematics for the
  Organization of Turn-Taking for Conversation.*
- Schegloff, Jefferson & Sacks (1977). *The Preference for Self-Correction in the
  Organization of Repair.*
- Horvitz, E. (1999). *Principles of Mixed-Initiative User Interfaces.*
- Gutwin, C. & Greenberg, S. *A Descriptive Framework of Workspace Awareness for
  Real-Time Groupware.*
- Sommers, N. (1980). *Revision Strategies of Student Writers and Experienced
  Adult Writers.*
- Brooks, J. (1991). *Minimalist Tutoring: Making the Student Do All the Work.*
- Wood, Bruner & Ross (1976). *The Role of Tutoring in Problem Solving.*
