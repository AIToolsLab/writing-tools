# Steps to simulate the data collection and analysis pipeline for study 1

For each of the three conditions (full-draft AI assistance, sentence-level AI assitance, and no AI assistance), three participants were simulated (total of 9 simulated participants). These were designed to mimic three possible participant personas: one that is fully engaged with the task ("appropriate reliance"), one that hopes to complete it as fast as possible and is not concerned with the quality of their work ("underreliance"), and one who is overly concerned with the quality of their work ("overreliance"). This file gives instructions for repeating that process, including how to locate and run scripts.

Each simulated participant completes the full study (with the exception of the informed-consent form) using an AI agent interacting directly with the user interface. Previous runs used Claude Opus 5. Playwright MCP tools enabled direct UI interaction. Each run takes place in a fresh browser context and begins by restarting the dev server to prevent data leaks between participants. Prompting the AI to wait between participants is optional, but allows for early stopping if unusual or unwanted behavior occurs.

For clarity, the chosen AI agent performing the task is referred to as "the agent," the colleague chat as "the colleague," and the AI sidebar assistant as "the assistant."

## Scripts

Two scripts in `experiment/scripts/` handle everything except the participant behavior itself:

- **`simulate_data.py`** — the personas, the shared prompt, and the run matrix. `make_runs()` produces
  one `Run` per participant with a unique username (`sim-04-room-e-engaged`) and a study URL carrying
  the condition and scenario, so the prompt never mentions either. `build_prompt(run)` assembles what
  the agent receives. Current matrix: 3 personas (engaged / anxious / unconcerned) x 3 conditions
  (c, e, n) x roomDoubleBooking = 9 runs.
- **`run_simulation.py`** — runs the batch unattended.

The persona is **not** recorded anywhere in the JSONL — `studyParams` carries only condition and
scenario. `runs.json`, written into the output directory, is what lets analysis join persona onto each
participant. Don't lose it.

## Steps to run the full pipeline

Step 1: Ensure `experiment/.env.local` exists and is filled in. The dev server loads it (these scripts
don't), and both the colleague chat and the AI sidebar depend on it — without it the runs still finish
but the data is worthless. See `experiment/CLAUDE.md` for what the file needs.

Step 2: Ensure nothing is listening on port 3000 (the script refuses to start otherwise):

```bash
netstat -ano | findstr ":3000"    # Windows — no output means the port is free
lsof -i :3000                     # macOS/Linux
```

If something is listening, stop it (on Windows, `taskkill /F /PID <pid>` using the PID in the last
column) or run the batch elsewhere with `--port`.

Step 3: Check the plan and the prompt the agent will get:

```bash
cd experiment
python scripts/simulate_data.py            # the run matrix
python scripts/run_simulation.py --dry-run # plan + the full prompt for run 1
```

Step 4: Start the batch. Every run is a billable agent session, so `--yes` is required; `--pause`
waits for you between runs so you can stop early (it is skipped automatically when there's no
terminal to prompt on, e.g. when the batch is backgrounded or run by an agent).

```bash
python scripts/run_simulation.py --yes --pause
```

Per run the script starts a fresh dev server, waits for the study route to compile, launches
`claude -p` with **only** the Playwright MCP tools allowed (so the simulated participant cannot read
`lib/scenarios.json` and learn facts it should have had to ask for), and works from an empty directory
outside the repo so `CLAUDE.md` is never auto-loaded. The browser profile is fresh per run
(`--isolated`), and the dev server is killed between runs.

Step 5: Read `results.json` in the output directory. Each run is `ok`, `check`, `skipped`, or `error`;
`check` means the log is missing required events, has the wrong condition, or shows too few
`documentUpdate` events (the sign that the agent used `fill()` instead of typing). Re-run anything
that isn't clean before analyzing (see below).

Output directory (default `logs/simulated-data/batch-<timestamp>/`):

| File | Contents |
|---|---|
| `<username>.jsonl` | the study log, moved out of `logs/` |
| `<username>.agent.jsonl` | the agent's own session transcript |
| `<username>.report.md` | the agent's end-of-run report |
| `<username>.devserver.log` | dev server output for that run |
| `runs.json` | run number, persona, condition, scenario, username, URL |
| `results.json` | status, problems, event count, duration, cost per run |

Step 6: `python scripts/parse_logs.py <output-dir>` for readable transcripts (see
`docs/experiment-log-parsing.md`).

## Re-running individual runs

`--runs` takes a subset, e.g. `--runs 4-6` or `--runs 2,7`. **Send it to a new `--out` directory, not
the batch you're repairing.** Each invocation rewrites `runs.json` and `results.json` from scratch
using only the runs it was given, so pointing a subset at the original directory replaces both files
with three-run versions and destroys the persona mapping for everything else — the one thing that
can't be reconstructed from the logs.

```bash
python scripts/run_simulation.py --yes --runs 4-6 --out logs/simulated-data/batch-<timestamp>-redo
```

Then move the good `<username>.*` files into the original batch directory by hand, leaving its
`runs.json` alone, and correct the affected entries in its `results.json`. Both files use the run
number as the key, so a bad run's row can be swapped for the new one.

A run whose `logs/<username>.jsonl` still exists is **skipped**, not repeated — that happens when a
previous attempt died before the file was collected. Delete or rename the stale log, or pass
`--force` to have the script set it aside automatically.
