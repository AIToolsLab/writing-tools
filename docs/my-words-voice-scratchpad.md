# My Words Voice — the Scratchpad as a Second Document

**Status:** built (see the implementation notes at the end). Companion to
[my-words-interaction-design.md](my-words-interaction-design.md) (the
one-move-per-turn reframe) and
[my-words-voice-native-research.md](my-words-voice-native-research.md) (the
voice-native architecture). This note records what the voice scratchpad is,
why it's shaped this way, and how it sits against related work.

## What was built

The Voice tab now has two surfaces the agent reaches with the **same five
tools** (`view`, `str_replace`, `insert`, `move`, `highlight`) plus a `target`
parameter: the **document** (the piece itself) and the **scratchpad** (the
writer's thinking space). Alongside that, five commitment mechanics:

1. **Reveal-then-apply.** Every edit first highlights its landing site and
   waits a beat before applying — ~750 ms for in-place changes, ~1.8 s for
   `move` (restructuring costs more to be wrong about). During the beat a ✕
   chip *or the writer starting to speak* vetoes the edit; the model is told the
   writer cancelled and asked to re-orient, not retry.
2. **Undo.** Each applied edit pushes its inverse (as paragraph-range splices,
   captured at apply time — never re-derived) onto a session stack. The agent
   has an `undo` tool and the header has an Undo button; both freshness-check
   the affected paragraphs first, so a region the writer has since hand-edited
   is refused rather than clobbered.
3. **Newlines as paragraph breaks.** A newline in edit text splits a
   paragraph; a newline in `old_str` matches across a boundary and merges.
   Every op lowers to one canonical mutation — a paragraph-range *splice* —
   which is also what undo inverts and what each editor host applies (the
   Lexical host node-incrementally, Word as a short sequence of scoped
   primitives).
4. **One applied edit per writer turn.** Enforced in code, not asked for in the
   prompt: the budget resets when the writer starts speaking, and only a
   *successful* apply spends it (a rejected or vetoed edit stays retryable). A
   burst of edits inside one model response is the "it ran off with my document"
   feeling in its purest form, and the reveal beat is too short to catch three of
   them. Scoping the budget to the writer's turn also makes the backchannel
   continuer real: "yeah, go on" is what releases the next move.
5. **Visible refusals.** Every path where an edit doesn't land — word-bank
   rejection, unusable arguments, veto, apply failure, stale undo — puts one
   short line in front of the writer, not just in the debug log. An agent that
   silently goes quiet after being blocked reads as broken rather than as
   principled, and mis-transcribed words make blocking routine.

The four control invariants (1, 2, 4, 5 above) are stated at the top of
`voice/session.ts` and covered by `__tests__/voiceControl.test.ts`.

The scratchpad panel renders lightweight Markdown conventions — `#` heading =
one idea, `-` lines = related notes, `[[idea words]]` = a writer-owned link to
another idea, `"quoted phrase"` = an anchor into the document (clicking it
highlights the phrase in the document). Clicking the panel drops into a plain
textarea; the conventions are **prompt guidance plus rendering hints, not a
parsed schema**.

## Design rationale

**Writer-owned structure, on both surfaces.** The word-bank rule
(`validateOp`/`validateText`) already guarantees the agent can only place the
writer's words in the document; the scratchpad extends the same rule to the
*thinking* representation. The conventions put linkage in the writer's hands
too: adjacency under a heading and explicit `[[...]]` links are things the
writer writes (or asks for); the agent may *suggest* a link aloud but doesn't
author one unasked. This carries forward the `prototype-mindmap` invariants
("the user authors every idea, label, hierarchy, role, and connection"; the AI
"questions and reflects the user's own words") while dropping its heavyweight
enforcement stack — here the invariant is carried by one validator that
already existed plus stance in the prompt.

**A parallel representation that is *allowed* to diverge.** Margin summaries,
outlines, and most "document map" designs are mirrors: they must track the
text or they're bugs. The scratchpad is deliberately **non-synced** — a place
where spoken phrasing gets parked verbatim before it's lost, where scraps
without a home collect (possibly for a different document), where structure is
sketched without committing the piece. Divergence is the feature: it's what
makes the space safe for tentative thinking, and it's what a voice writer
lacks most (speech is serial and evanescent; the scratchpad is the durable,
glanceable residue of it).

**Navigate-before-edit instead of consent gates.** The optimistic-vs-propose
choice (see the Walkthrough/Propose strategies) is really about *where the
acceptance slot sits and what counts as acceptance*. A per-edit accept/reject
gate makes the writer produce a full turn where conversation needs only a
continuer — the argument our interaction-design note makes against typed "ok"
applies doubly to voice. But pure post-hoc undo places all repair after
commitment, and repair is cheapest early. The synthesis here: **announce →
reveal → veto window → apply → undo**. Silence within the window is the
conversationally unmarked acceptance; the ✕ chip is an accelerator, not a
gate. One honest constraint: in a sub-second window only a tap can outrun ASR
latency, so spoken objections land as undo — acceptable, because the reveal's
job is converting surprise into anticipation, not catching every error. The
per-op-kind window length keeps commitment latency a research knob on the same
axis the two text strategies span.

**Markdown conventions, not a data model.** The mind-map prototype showed the
cost of a first-class idea graph: a Source Bank, a validator, readiness
machinery, command grammars. Plain text with conventions gets the
focus-on-one-idea-and-its-relations behavior at prompt level, keeps the writer
able to type anything (it's just a textarea), keeps persistence trivial (it's
the same scratchpad string the text tabs already save), and leaves the door
open to promote a convention into structure later if usage proves it out.

## Related work

- **Rambler** (Lin et al., CHI 2024) — dictation with LLM "gist extraction":
  keywords/summaries as anchors for reviewing and macro-revising spoken text.
  Closest system to a voice-mode scratchpad, but its gists are
  *model-authored paraphrases*; ours are the writer's verbatim words, enforced
  in code. The inversion — the machine may only reflect, never paraphrase, in
  the thinking space — is the point.
- **InkSync** (Laban et al., UIST 2024) — anchored, executable, verifiable
  edit suggestions rendered in-document, with a Warn/Verify/Audit provenance
  chain. Our validate → reveal → undo triad is the voice-native analog:
  InkSync assumes eyes-and-mouse verification of each suggestion; a spoken
  conversation needs the acceptance slot to default to silence.
- **Dang et al.** (UIST 2022) — continuous paragraph-level margin summaries as
  an external, parallel representation writers use to reflect and navigate. A
  linear, *non-editable*, always-synced precedent; the scratchpad is editable,
  writer-owned, and free to diverge.
- **Graphologue / Sensecape** (UIST 2023) — LLM output as node-link diagrams /
  spatial canvases. Maps of the *model's* content, where ours is a map of the
  *writer's* thinking that the model may only navigate.
- **prototype-mindmap** (this repo, branch `feat/uist`) — the direct ancestor:
  writer-owned concept map with own-words provenance and draft anchoring. Its
  invariants survive here as stance + one validator; its React Flow surface,
  Source Bank, and enforcement machinery deliberately do not.

## Limitations / next

- Google Docs still has no `applyEdit`, so voice edits (and undo) don't work
  on that host; `selectPhrase`-based reveals do.
- Paragraph identity is positional. Stable IDs (Word's newer
  `Paragraph.uniqueLocalId`) would end paragraph-number drift; numbers + text
  anchors are good enough for the prototype.
- A veto needs the writer's speech to *start* within the window (or a tap on the
  ✕ chip). An objection formed after the beat still lands as undo — which is the
  common case for anything the writer has to read before reacting to.
- Whether the Lexical host scrolls the selection into view when unfocused is
  still to be verified per-surface; if it doesn't, add a
  `scrollSelectionIntoView` to `EditorAPI` (kept out until the gap is
  demonstrated).
- The `[[link]]` and quoted-anchor conventions are unvalidated hunches about
  how writers will actually mark relationships; watch usage before promoting
  them into anything structural.

### Deliberately deferred

Four gaps we identified, decided not to close yet, and should not rediscover
from scratch. The first two are design work and are tracked as issues #555 and
#556; the last two are known holes recorded here only.

- **No persistent record of what changed.** (#555) The reveal highlight is transient
  and the next edit's selection overwrites it; the labelled Undo button names
  only the top of the stack; the rest is behind the Debug disclosure. So a writer
  who looks away for ten seconds cannot answer "what did it change?" — the
  awareness half of the dual-channel story only works if you were watching.
  The substrate is already there: each undo entry carries
  `{ target, splices, description }`, and a splice holds both the old and new
  text of the affected paragraph range, so a diff/history sidebar needs
  *retention* (the stack caps at 10 and discards on undo) rather than new
  plumbing. Pairs with **Review-out-loud** in the research note's open axes —
  the spoken and visible halves of the same question, worth designing together.
- **No floor control.** (#556) The mic is open the whole session: no mute, and no way
  to think out loud without the partner treating it as material to act on.
  Candidates, in rising cost: a dictate/converse switch, push-to-talk for
  commands, or a spoken address marker ("computer, …"). This is the
  content-vs-command axis in its cheapest form, and probably the largest single
  lever on whether the writer feels like the conductor. Left unbuilt on purpose:
  it wants a session with a real writer, not more code.
- **Two undo histories that don't know about each other.** The session stack and
  the host's native Ctrl-Z are independent. Freshness-checking makes the failure
  safe — a hand-edited region is refused, not clobbered — but "Undo did nothing"
  is still confusing. Decide what Ctrl-Z should mean during a voice session
  before using this in a study.
- **Interim transcripts license words the writer never said.** Interims feed the
  word bank so the model isn't rejected for shaping something just spoken, which
  is the right trade for fluency — but ASR guesses thereby become licensed words,
  and interims are later revised. So the partner can place a word the writer
  never actually said: a small breach of the one invariant the project rests on.
  Look at real transcripts before deciding whether it matters.

## Implementation map

| Piece | Where |
| --- | --- |
| Splice lowering, inversion, freshness | `frontend/src/pages/my-words/interaction/ops.ts` |
| Reveal/veto + splice adapter (per-host) | `frontend/src/pages/my-words/interaction/editor.ts` |
| Lexical node-incremental `applySplice` | `frontend/src/editor/editor.tsx` (+ `index.tsx`) |
| Word `delete_paragraph` | `frontend/src/api/wordEditorAPI.ts` |
| Voice tool routing, undo stack, control invariants | `frontend/src/pages/my-words/voice/session.ts` |
| Spoken-channel seam / OpenAI Realtime transport | `frontend/src/pages/my-words/voice/transport.ts`, `voice/realtime.ts` |
| Tool schemas | `frontend/src/pages/my-words/voice/tools.ts` |
| Stance (the prompt) | `frontend/src/pages/my-words/voice/prompt.ts` |
| Scratchpad panel | `frontend/src/pages/my-words/voice/VoiceScratchpad.tsx` |
| Voice UI (You-said strip, labelled Undo, ✕, notices) | `frontend/src/pages/my-words/voice/VoiceSession.tsx` |
| Control-invariant tests | `frontend/src/pages/my-words/__tests__/voiceControl.test.ts` |
