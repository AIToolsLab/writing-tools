# Mindmap evaluation harness

Run the real `processTurn` pipeline against the running backend:

```powershell
npm run eval
npm run eval -- --scenario compound-abstract-opening
```

The runner compares each scenario's identical user/control script at L0 and L2.
It writes a timestamped directory under `eval/runs/` containing:

- `transcript.jsonl` — one complete record per assistant turn;
- `summary.md` — descriptive repair and first-pass-mirror metrics;
- `handscore.md` — the human review sheet;
- `manifest.json` — run configuration and selected scenarios.

Set `MINDMAP_EVAL_BACKEND_URL`, `MINDMAP_EVAL_MODEL`, or
`MINDMAP_EVAL_REASONING_EFFORT` to override the local defaults. The
`newContentWordRatio` canary is not a gate: hand-score outputs before making
claims about assistance-level behavior. This first slice deliberately has no
LLM-as-judge.
