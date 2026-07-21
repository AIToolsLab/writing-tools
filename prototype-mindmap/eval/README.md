# Mindmap evaluation harness

Run the real `processTurn` pipeline against the running backend:

```powershell
npm run eval
npm run eval -- --scenario compound-abstract-opening
npm run eval -- --suite manipulation-check
```

The runner compares each scenario's identical user/control script at L0 and L2.
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
directions, AI attribution, and whether a question embeds an unstated premise.
Use `NA` for the question-premise field when the response is not a question.
After filling every Y/N/NA judgment, aggregate it with:

```powershell
npm run eval:report -- --run eval/runs/<timestamp>
```

The
`newContentWordRatio` canary is not a gate: hand-score outputs before making
claims about assistance-level behavior. This first slice deliberately has no
LLM-as-judge.
