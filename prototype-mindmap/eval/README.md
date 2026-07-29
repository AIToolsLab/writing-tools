# Mindmap evaluation harness

Run the real `processTurn` pipeline against the running backend:

```powershell
npm run eval
npm run eval -- --scenario compound-abstract-opening
npm run eval -- --suite manipulation-check
```

The runner compares each scenario's identical user/control script at L0 and L2.
Each scenario may designate a scored turn; otherwise its final live user-turn
outcome is scored. All assistant turns remain in `transcript.jsonl`, while the
reportable manipulation-check denominator contains only the 40 designated
outcomes.
It writes a timestamped directory under `eval/runs/` containing:

- `transcript.jsonl` — one complete record per assistant turn;
- `summary.md` — descriptive repair and first-pass-mirror metrics;
- `handscore.md` — the human review sheet;
- `handscore.csv` — stable reportable scoring rows;
- `manifest.json` — run configuration and selected scenarios.

Set `MINDMAP_EVAL_BACKEND_URL`, `MINDMAP_EVAL_MODEL`, or
`MINDMAP_EVAL_REASONING_EFFORT` to override the local defaults. Set
`MINDMAP_EVAL_TRANSPORT` to `chat_json` or `responses_tools`.

The manipulation-check suite writes a stable 40-row `handscore.csv`. Its rubric
separately records introduced concepts, unstated relationships, unraised
directions, AI attribution, whether a question embeds an unstated premise, and
whether literal quotation makes a question's referent or syntax confusing. Use
`NA` for both question-only fields when the response is not a question.
After filling every Y/N/NA judgment, aggregate it with:

```powershell
npm run eval:report -- --run eval/runs/<timestamp>
```

The
`newContentWordRatio` canary is not a gate: hand-score outputs before making
claims about assistance-level behavior. This first slice deliberately has no
LLM-as-judge.

Operational fields include end-to-end duration, provider transport, model
profile, reasoning effort, token counts when returned, model-call count,
recovery stage, terminal outcome, and structured/tool validity. The reportable
quality fields are human judgments; operational canaries and lexical overlap do
not determine directiveness or authorship.

Current evidence status (2026-07-21): harness type-checks and deterministic
reporting tests are green. The latest prompt/recap/nesting checkpoints still
need a fresh live provider run and completed 40-row hand score before new model
performance claims are reportable. Keep all raw outputs under ignored
`eval/runs/`.
