# Interaction Concepts: Writing as Service, AI as Formation

Proposed new interaction concepts for Thoughtful, extending the central concept
("LLM helps thinking and reflection instead of replacing writing") with two
anchor values and a family of related ones. Concepts are split by feasibility:
ones that fit the current Word sidebar add-in (read document context, select
phrases, no direct insert) and ones that need a custom editor.

## Values

1. **Thinking as serving others** — writing is an act of service; the reader's
   understanding is the point, not the text.
2. **AI use should improve your unaided work** — the tool's success metric is
   how you perform *without* it.
3. **Stewardship of the reader's attention** — the reader's time is a gift;
   concision and clarity are forms of respect.
4. **Honesty about provenance** — your name on the document means your mind in
   the document.
5. **Formation over output** — every writing session is also practice; the tool
   is a coach, not a crutch.
6. **Humility** — seek the strongest objection before the reader finds it.
7. **Hospitality** — write for the rushed, the skeptical, the non-native, the
   marginal reader.
8. **Faithfulness between intention and text** — what you meant to do to the
   reader and what the prose actually does should match.

## In-sidebar concepts

These work within the current add-in affordances (`frontend/src/api/wordEditorAPI.ts`:
document context, selection, doctext links).

### 1. The First Read

A reader persona narrates a live first encounter with the draft — "here I'm
nodding… here I start skimming… here I'd stop reading" — anchored with the
existing doctext links. Upgrades `analysis_readerPerspective` from reader
*questions* to reader *experience*. Variant: a "table read" with three personas
(the rushed boss, the skeptic, the newcomer) reacting to the same passage.

*Values: serving others, hospitality, stewardship of attention.*

### 2. Say-Back

The AI states what it understood the document to say and what it thinks the
reader is being asked to do — and nothing else. The writer diffs that against
what they meant; the gap is the diagnostic. Medical teach-back, applied to
prose.

*Values: faithfulness, serving others.*

### 3. The Reader's Reply

For emails: predict the reply this message will actually get. If the predicted
reply is a clarifying question, the email has failed before it was sent. Slots
directly into the experiment's email scenarios as a condition.

*Values: serving others, stewardship of attention.*

### 4. Predict-the-Reader

Before the AI shows reader questions, the writer commits to three guesses of
their own; the AI then reveals its list and the overlap is scored over time, so
the writer can watch their reader-modeling skill improve — the transfer value
made measurable. Doubles as a new experiment condition.

*Values: AI improves unaided work, formation over output, humility.*

### 5. Who Is Served?

Extend the Revise page's audience field into a covenant pinned at the top: who
reads this, what they need to do or decide, what a good outcome looks like *for
them*. Every other feature conditions on it — and refuses to run until it
exists. The tool treats "who is this for?" as a precondition for help, not a
nice-to-have.

*Values: serving others, faithfulness.*

### 6. The Post-Game Review

The backend already logs every suggestion shown, accepted, and deleted as JSONL
(`backend/src/logging.ts`). Use it the way chess engines review games: a
periodic coach's report on writing sessions — where the writer leaned on
suggestions verbatim, which reader questions they consistently fail to
anticipate, how reliance is trending across weeks.

*Values: AI improves unaided work, formation over output, honesty about
provenance.*

### 7. Earn-the-Answer

Every generative feature first asks for the writer's one-sentence hypothesis —
"what do *you* think the weakest part is?" — and the AI responds to their
thinking rather than the blank page. The generation effect, built into the
interaction grammar of the whole app.

*Values: AI improves unaided work, formation over output.*

## Needs-custom-editor concepts

### 8. Marginalia

Reader reactions rendered as a reader's pencil in an actual margin —
underlines, stars, "lost me here" — spatially anchored and ephemeral, like
getting a draft back from a thoughtful friend rather than a list in a panel.

*Values: serving others, hospitality.*

### 9. Skim View / Reading Playback

Render the document as a 20-second skimmer experiences it: first lines and
headers vivid, everything a busy reader skips dimmed, a marker where they'd
bail. Playback at realistic reading speed. Makes stewardship of attention
visible.

*Values: stewardship of attention, hospitality.*

### 10. The Intent Ledger

Two panes: per-section intent on the left ("this paragraph should make them
feel the urgency"), prose on the right, with live drift detection between them.
Faithfulness as a first-class UI object.

*Values: faithfulness, serving others.*

### 11. Stuckness-aware questions

Keystroke-level detection of hesitation — long pauses, delete loops — triggers
a single question (never text) at the exact moment of stuckness. Help arrives
when thinking stalls, not when a button is pressed.

*Values: formation over output, AI improves unaided work.*

### 12. Inkwell (provenance-tracked ink)

Per-character provenance: yours, AI-prompted-yours, AI-verbatim. An honesty
heatmap of the document and an exportable disclosure statement. Feeds the
Post-Game Review.

*Values: honesty about provenance.*

### 13. The Dojo

Scaffolds that deliberately fade. Micro-drills generated from the writer's own
past drafts targeting their recurring weaknesses, spaced-repetition style, plus
periodic "no-AI days" that measure unaided performance. The product's headline
KPI is how well you write *without it* — a tool that reports on its own
obsolescence.

*Values: AI improves unaided work, formation over output.*

### 14. Blind Rewrite

AI suggestions vanish after the writer reads them; the idea must be
reconstructed in their own words with paste blocked. Forces encoding over
copying — and the similarity between suggestion and reconstruction is a clean
dependent measure for the over-reliance study.

*Values: AI improves unaided work, honesty about provenance.*

## Research notes

Concepts 3, 4, 13, and 14 aren't just product features — they're
instrumentable conditions in the existing experiment paradigm
(`experiment/docs/research-overview.md`): Predict-the-Reader overlap scores,
Reader's Reply accuracy, Blind Rewrite similarity metrics, and no-AI-day deltas
all give publishable signal alongside the build.
