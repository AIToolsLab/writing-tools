# Chat: document context and own-words edits

Chat is a coach that can also propose edits to the document, under the My Words
constraint: it may only place the writer's own words. Plan and decisions:
[#583](https://github.com/AIToolsLab/writing-tools/issues/583). Code:
`frontend/src/pages/chat/` and the shared `frontend/src/docTools/`.

## What the model sees

The transcript is the model's own history (`ModelMessage[]`, tool calls
included), kept in `ChatContext`. Each writer turn is one user message with two
text parts: a `<document_context>` block the app attaches, then what the writer
typed (the only part their bubble shows). The block holds:

- the brief, if set;
- on the first turn, the whole document, paragraphs numbered as `view` numbers
  them (numbers are tool coordinates; the model is told not to mention them);
- on later turns, an **edit note**: a paragraph diff (`docTools/editNote.ts`)
  between what the model last saw and the document now, omitted when nothing
  changed and reduced to "call `view`" past a size cap;
- the paragraph around the cursor or selection, marked.

"What the model last saw" (`ChatDocState.baseline`) moves on each send, each
`view`, and after an applied edit, so the note reports only the writer's changes.

## Proposals

On hosts with `applyEdit` (`canEdit`), Chat offers `str_replace`, `insert` and
`move` (`docTools/editTools.ts`). `chatTools.ts` gates each call in
`toolApproval`:

1. dry-run against the current document (`lowerOp`); a miss is denied;
2. the word-bank check (`validateOp`); a failure is denied with the offending
   words as the reason;
3. otherwise `'user-approval'`: the stream stops and the card appears.

The card does not select anything in the document on its own: the writer may
be typing there, and a selection that appears under them is replaced by their
next keystroke. "Show in document" selects the target on request (trimming the
quote until it's found, since Word's search rejects long strings).

Denials go back to the model, never to the writer, saying where the text
breaks ("…have "alpha beta", but never followed by "gamma""). The check
(`docTools/corpus.ts`) accepts runs of content words lifted verbatim, or
stitched from pieces that overlap by at least two words, joined by punctuation
and a closed set of glue words (no connectives: "as" was dropped because it
can mean "because"). Word bank: the live
document, every paragraph the model has seen this conversation (so deleted
words can be reinstated), the writer's typed messages, and the brief, but not
the `<document_context>` blocks or assistant text.

The app writes every answer itself (`answerProposal`): the approval response
*plus* the tool result. Accept applies the edit first (no reveal beat) and
records the report; Decline and "set aside" (the writer sent a new message
with the card open) record `execution-denied` with a reason. The SDK skips
approvals that already have a result, so it only continues the conversation,
and the history stays valid whatever comes next. That matters because the SDK
resolves approvals only when they're the last message. `applyProposal` is the
only path that edits the document: the tools' `execute` throws, so if the SDK
ever did run one, the proposal shows as failed rather than being applied twice.

## Undo

Each applied edit stores its inverse splices (`appliedEdits`, by tool call).
Undo works in any order: `docTools/undo.ts` relocates a stale index to the one
place the edit's text still occurs, and refuses if it changed or occurs more
than once. A splice that removes nothing (putting back a paragraph a `move`
took out) has no text of its own to find, so it records its neighbors
(`prevParagraph`/`nextParagraph`, the field names #589 plans for hosts to
enforce) and is re-anchored between them by the same rule. An undo is not recorded as seen, so the next edit note reports it.

## Logging

`chatLog.edit` emits `edit_proposed`, `edit_auto_denied` (`reason`:
`word_bank` | `no_match`), `edit_accepted`, `edit_declined`, `edit_set_aside`,
`edit_failed`, `edit_undone`, `edit_undo_refused`. The op is in `proposal` and
the failing words in `offending`, both document-level in the consent gate, so
at the default (usage) level we see how often each happens but not the text.
