# Reflective Mind-Map Design

This is the canonical design document for `prototype-mindmap`. The companion
`airtightness-report.md` is the enforcement appendix. Older implementation
briefs were removed after they became stale.

## Aim

This is a writing-thinking tool, not a writing-production tool. The user
externalizes their own thinking into a concept map. The AI helps by questioning,
reflecting the user's own words, noticing when clarification is needed, and
capturing confirmed structure. It never authors ideas, names relationships, or
decides what belongs where.

The central bet is that constrained dialogue plus a user-grounded external map
helps a person construct and recognize their own thinking more deeply than
freeform chat or AI-generated prose.

## Invariants

1. **The user authors every idea, label, hierarchy, role, and connection.**
2. **The AI never authors ungrounded structure.** It questions and reflects the
   user's own words; it does not invent ideas or relationships.
3. **Validation gates the AI, never the user.** The map is the user's sovereign
   workspace.
4. **Selection is authorship.** The AI never decides which ideas become cards.
5. **The slider moves eagerness, never the authorship gate.**
6. **Enforcement lives in code; calibration lives in config.**

Useful corollary: the AI may interpret freely, but the consequential act that
creates structure is either fenced by grounding plus user confirmation, or is a
direct user action.

## Required Behavior

### Capture

A large voice/text turn is split into sentence-level units. Each unit is recorded
verbatim in the Source Bank. Nothing the AI says is ever treated as the user's
words.

### Questioning

The coach makes one move per turn: at most a short grounding clause followed by a
single question, ending on that question. It chooses stance (`settle`, `narrow`,
`deepen`, `organize`, `challenge`) based on the user's state. It does not re-ask
settled points, validate as the whole reply, or offer inferred structure for the
user to approve.

### Mirroring

A mirror restates structure in the user's own words. It is offered only when a
candidate is ready and only after validator checks pass. Failed mirrors become
clarifying questions. A mirror is split into confirmable chunks; only confirmed
chunks become cards.

### Carry-Forward

When the user explicitly commits an idea ("the main idea I want to carry forward
is X"), a single clear, grounded statement can mirror immediately. It still must
validate and still requires confirmation. This fast-track is honored at any
slider position.

### Direct Map Commands

Direct map commands are user actions, not AI reflections.

- "Put X on the map" creates a user-authored card from the user's exact words.
- "Put X under Y" nests a card under an existing uniquely resolved card.
- "Connect X to Y" creates a user-authored connection.
- "Connect X to Y with 'label'" uses the user-supplied label only if that label
  is grounded in the current turn. If the label is ungrounded, the edge is kept
  unlabeled.

These commands do not go through mirror validation or confirmation. Declaratives
such as "X is a main idea" or "X supports Y" are not commands; they go through
the mirror/question path. Vague references such as "put my main point on the map"
ask for exact wording. Ambiguous structure references ask rather than guess.

### No Harvesting

For long/exploratory turns, the coach must not extract a fixed number of cards.
It mirrors only what the user explicitly selected or grounded clearly enough;
otherwise it asks one focusing question that hands selection back to the user.
The longer and richer the input, the more careful the coach must be about
selecting structure for the user.

### Sovereign Map

The user can freely create, edit, drag, nest, connect, delete, and undo. No map
action is blocked by validator/readiness gates. User-introduced wording writes
back to the shared Source Bank so later AI turns stay grounded in the user's
canvas work.

### Slider

The Think-to-Map slider changes eagerness and pacing for non-declared ideas. It
never changes grounding, confirmation, or whether explicit declarations and
direct commands are honored.

### Diagnostics

The Debug panel exposes mode, suppression reason, validation check scores,
validation payloads, accelerated candidates, and readiness notes. This turns
"felt wrong" reports into concrete gate diagnoses.

## Implementation Map

| Behavior | Where | Mechanism |
| --- | --- | --- |
| Capture | `store.ts`, `normalize.ts` | `SourceBank.addSegmented`, sentence/newline segmentation |
| Questioning | `api.ts`, `controller.ts`, `llm-contract.ts` | Prompt stance + anti-repeat and stuck overrides |
| Readiness | `readiness.ts`, `signals.ts`, `controller.ts` | Code-derived relation signals, spontaneous hierarchy rule |
| Validation | `validator.ts` | Lexical grounding + span/relationship grounding |
| Confirmation | `App.tsx` | Per-claim confirm/decline creates cards only on confirm |
| Carry-forward | `llm-contract.ts`, `controller.ts`, `readiness.ts` | `carryForwardCandidateIds`, idea-only density acceleration |
| Direct commands | `llm-contract.ts`, `controller.ts`, `map-commands.ts` | `mapCommands`, exact current-turn spans, unique exact reference resolution |
| Map | `map-store.ts`, `Map.tsx` | One primitive: `ThoughtUnit` card; nesting is `parentId`; connections have label cards |
| Draft anchoring | `App.tsx`, `api.ts` | Read-only draft + verbatim `questionAnchor` highlight |
| Slider | `config.ts` | `withQuestionIntentBias` changes pacing thresholds only |
| Diagnostics | `controller.ts`, `Map.tsx` | `suppressionReason`, `validationDebug`, readiness notes |

The integration that must never break: the map and the chat loop share the same
`SourceBank` instance (`stateRef.current.bank`). Map writes and undo restores go
through that instance.

## Decisions and Rejected Alternatives

- **LLM interpretation, code fences.** Coaching stance, commitment recognition,
  and command speech acts are LLM-interpreted. Consequential gates remain
  code-enforced: validator checks, hierarchy spontaneity, exact current-turn
  command spans, and unique reference resolution.

- **No controller trim for mirror chunk count.** A hard cap would silently drop
  user-grounded claims and move selection into code. If many ideas are ready,
  ask a focusing question; do not trim.

- **Declaration recognition is not slider-gated.** Explicit user intent is
  honored at any position. The slider only tunes pacing for non-declared ideas.

- **Carry-forward is idea-only.** It accelerates density only. It never satisfies
  relationship clarity, hierarchy spontaneity, or connection grounding.

- **Direct commands bypass mirror validation.** They are user actions. The code
  checks exact words and references, not whether the user's action is "ready."

- **Map-command labels are never invented.** Ungrounded labels are stripped;
  the user-commanded connection remains unlabeled.

- **Exact structure resolution for now.** Existing card references must resolve
  to exactly one normalized card. This avoids silent wrong structure, but can
  create duplicates on partial references. Future work can add "did you mean X?"
  disambiguation.

- **Nested cards render as embedded DOM, not xyflow subflows.** This keeps the
  card as the one primitive and makes nesting visually literal.

- **Model remains `gpt-5.4-mini`.** Observed failures have been coordination
  failures, not model-judgment failures. Upgrade only if judgment failures
  become persistent.

- **Eval rubric: mirror within about one productive turn.** One useful follow-up
  on a compound idea is a pass; forcing immediate mirroring everywhere would
  make the tool an extractor.

## Current Status

Built and tested:

- capture/segmentation
- question stance and anti-repeat behavior
- readiness and validation
- per-chunk mirror confirmation
- carry-forward acceleration
- concept map cards, nesting, connections, delete, undo
- draft anchoring
- Think-to-Map slider
- diagnostics
- direct map commands: `create_card`, `nest_card`, `connect_cards`

Known tradeoff: command structure resolution is exact and conservative. It fails
away from wrong structure, but can require the user to use the exact visible card
text or create a duplicate from a partial reference.
