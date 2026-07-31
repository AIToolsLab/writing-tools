# Reading experiment study logs

Study sessions are logged as JSONL (one event per line) under `experiment/logs/`.
Each line looks like:

```json
{"username": "...", "event": "...", "extra_data": {...}, "timestamp": "...", "wave": "...", "gitCommit": "..."}
```

The files are hard to read directly because keystroke-level `documentUpdate`
events make up ~90% of the lines (500+ per session). `experiment/scripts/parse_logs.py`
collapses those into typing bursts and interleaves them with everything else on a
single timeline.

## Usage

```bash
cd experiment
python scripts/parse_logs.py logs/simulated-data/pilot-attempt      # a whole directory
python scripts/parse_logs.py logs/dave.jsonl --stdout               # one file, to the terminal
python scripts/parse_logs.py logs/foo --format text --out /tmp/out  # plain text instead of Markdown
python scripts/parse_logs.py logs/foo --snapshots                   # + full document after each burst
```

Stdlib only — no dependencies.

Output (default `<input-dir>/readable/`):

- `<participant>.md` — one transcript per log
- `index.md` — table of all participants with links
- `summary.csv` — same table, for a spreadsheet or pandas

## What a transcript contains

1. **Header** — condition (with its full name), scenario, wave, task and session
   duration, questions asked of the colleague, AI suggestions shown, final word count.
2. **Intro survey** responses.
3. **Timeline**, timestamped `mm:ss` from the first event:
   - `COLLEAGUE` / `YOU` chat messages
   - `AI SUGGESTION [type]` with the full suggestion text, whether it was an
     auto-refresh or user-requested, and the latency
   - `WRITING` bursts — a run of consecutive edits shown as a diff of what was
     added/removed, with the edit count and elapsed time
   - `TASK START` / `TASK COMPLETE` / `SURVEY COMPLETE` markers
4. **Final email** — subject and full text.
5. **Post-task survey** responses.

Page-view events are dropped from the timeline (the phase markers cover the same
ground). `aiRequest` events are folded into their matching `aiResponse` so they
don't split a burst of continuous writing.

## Notes

- Document text is reconstructed as `editorState.beforeCursor + selectedText + afterCursor`.
- A pause longer than `BURST_GAP_SECONDS` (20s, top of the script) splits one
  typing burst into two, so hesitation stays visible.
- The header counts are derived, not logged: `questions_asked` counts
  `chatMessage:user` events, `ai_suggestions_shown` counts `aiResponse:*` events
  (which includes auto-refreshes the participant may never have read).
