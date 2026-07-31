#!/usr/bin/env python3
"""Run agent-simulated participants unattended, one Claude Code session per run.

For each run in the matrix from simulate_data.py this script:

  1. starts a fresh dev server and waits for the study route to compile,
  2. launches `claude -p` with ONLY the Playwright MCP tools allowed, so the
     simulated participant can see nothing but the UI (no repo, no API calls),
  3. moves logs/<username>.jsonl into the output directory,
  4. checks the log for the events and typing cadence a real session produces.

Usage:
    python scripts/run_simulation.py --dry-run
    python scripts/run_simulation.py --runs 1 --yes
    python scripts/run_simulation.py --yes --pause --out logs/simulated-data/batch-1

Each run is a billable Claude Code session, so the batch will not start without
--yes. Run this from the experiment/ directory; .env.local is loaded by the dev
server, not by this script.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from simulate_data import build_prompt, make_runs, write_manifest

EXPERIMENT_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = EXPERIMENT_DIR / "logs"
IS_WINDOWS = os.name == "nt"

# The participant may use the browser and nothing else. Anything not listed here
# is denied in print mode, which is what keeps the agent from reading
# lib/scenarios.json and learning the facts it is supposed to have to ask for.
ALLOWED_TOOLS = "mcp__playwright"

# --isolated gives every run a throwaway browser profile; the viewport matches
# the pilot sessions.
PLAYWRIGHT_MCP = {
    "mcpServers": {
        "playwright": {
            "command": "npx",
            "args": ["@playwright/mcp@latest", "--isolated", "--viewport-size", "1600,1000"],
        }
    }
}

# Events every completed session contains.
REQUIRED_EVENTS = [
    "Started Study",
    "surveyComplete:intro-survey",
    "taskStart",
    "taskComplete",
    "surveyComplete:post-task-survey",
    "view:final",
]

# Typing realism. pressSequentially(delay=180) lands at ~0.19s between
# documentUpdate events; fill() collapses a whole email into a handful.
MIN_DOCUMENT_UPDATES = 50
MAX_MEDIAN_KEYSTROKE_GAP = 1.0


# --------------------------------------------------------------------------
# processes
# --------------------------------------------------------------------------


def spawn(cmd: list[str], cwd: Path, stdout, env: dict | None = None) -> subprocess.Popen:
    """Start a child in its own process group so the whole tree can be killed."""
    kwargs: dict = {}
    if IS_WINDOWS:
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen(
        cmd, cwd=str(cwd), stdout=stdout, stderr=subprocess.STDOUT,
        env=env, text=True, encoding="utf-8", errors="replace", bufsize=1, **kwargs
    )


def kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                           capture_output=True, check=False)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except Exception as exc:  # already gone, or no permission
        print(f"  warning: could not kill pid {proc.pid}: {exc}", file=sys.stderr)
    try:
        proc.wait(timeout=30)
    except subprocess.TimeoutExpired:
        print(f"  warning: pid {proc.pid} did not exit", file=sys.stderr)


def port_is_open(port: int) -> bool:
    import socket

    with socket.socket() as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def http_ok(url: str, timeout: float = 5.0) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return resp.status == 200
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError):
        return False


def start_dev_server(port: int, log_path: Path, ready_timeout: float,
                     warmup_url: str) -> subprocess.Popen:
    npm = shutil.which("npm") or "npm"
    handle = log_path.open("w", encoding="utf-8")
    proc = spawn([npm, "run", "dev", "--", "--port", str(port)], EXPERIMENT_DIR, handle)

    base = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + ready_timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"dev server exited early (see {log_path.name})")
        if http_ok(base):
            # Compile the study route now so the participant doesn't meet a
            # 20-second blank page and report the study as broken.
            http_ok(warmup_url, timeout=90)
            return proc
        time.sleep(1.0)

    kill_tree(proc)
    raise RuntimeError(f"dev server not ready after {ready_timeout:.0f}s (see {log_path.name})")


# --------------------------------------------------------------------------
# the agent session
# --------------------------------------------------------------------------


def run_agent(prompt: str, model: str, transcript_path: Path, cwd: Path,
              timeout: float) -> dict:
    """Run one `claude -p` session, streaming progress. Returns its result event."""
    claude = shutil.which("claude")
    if claude is None:
        raise RuntimeError("`claude` not found on PATH")

    cmd = [
        claude, "-p", prompt,
        "--model", model,
        "--mcp-config", json.dumps(PLAYWRIGHT_MCP),
        "--strict-mcp-config",
        "--allowedTools", ALLOWED_TOOLS,
        "--output-format", "stream-json",
        "--verbose",
    ]

    proc = spawn(cmd, cwd, subprocess.PIPE)
    timer = threading.Timer(timeout, lambda: kill_tree(proc))
    timer.start()

    result: dict = {}
    try:
        with transcript_path.open("w", encoding="utf-8") as transcript:
            assert proc.stdout is not None
            for line in proc.stdout:
                transcript.write(line)
                transcript.flush()  # so the transcript can be read while the run is live
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    continue
                describe_event(event)
                if event.get("type") == "result":
                    result = event
        proc.wait(timeout=60)
    finally:
        timer.cancel()
        kill_tree(proc)

    result["exit_code"] = proc.returncode
    return result


def describe_event(event: dict) -> None:
    """One terse line per tool call, so a stalled run is visible."""
    if event.get("type") != "assistant":
        return
    for block in event.get("message", {}).get("content", []):
        if block.get("type") == "tool_use":
            name = block.get("name", "?").replace("mcp__playwright__browser_", "")
            arg = block.get("input", {})
            detail = arg.get("url") or arg.get("text") or arg.get("element") or arg.get("code", "")
            detail = str(detail).replace("\n", " ")[:70]
            print(f"    > {name} {detail}")
        elif block.get("type") == "text" and block.get("text", "").strip():
            print(f"    | {block['text'].strip().splitlines()[0][:90]}")


# --------------------------------------------------------------------------
# log collection and checking
# --------------------------------------------------------------------------


def check_log(path: Path, condition: str, scenario: str) -> list[str]:
    """Everything wrong with this log, as human-readable strings."""
    problems: list[str] = []
    events = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError:
            problems.append("log contains an unparseable line")

    names = [e.get("event", "") for e in events]
    for required in REQUIRED_EVENTS:
        if required not in names:
            problems.append(f"missing {required}")

    updates = [e for e in events if e.get("event") == "documentUpdate"]
    if len(updates) < MIN_DOCUMENT_UPDATES:
        problems.append(
            f"only {len(updates)} documentUpdate events — the agent probably used "
            "fill() instead of pressSequentially()"
        )
    elif len(updates) > 1:
        stamps = [datetime.fromisoformat(e["timestamp"].replace("Z", "+00:00")) for e in updates]
        gaps = [(b - a).total_seconds() for a, b in zip(stamps, stamps[1:])]
        median = statistics.median(gaps)
        if median > MAX_MEDIAN_KEYSTROKE_GAP:
            problems.append(f"median keystroke gap {median:.2f}s — typing is not keystroke-paced")

    ai_responses = [n for n in names if n.startswith("aiResponse:")]
    if condition == "n" and ai_responses:
        problems.append(f"condition n but {len(ai_responses)} aiResponse events")
    if condition != "n" and not ai_responses:
        problems.append(f"condition {condition} but no aiResponse events")

    params = next(
        (e["extra_data"]["studyParams"] for e in events
         if isinstance(e.get("extra_data"), dict) and "studyParams" in e["extra_data"]),
        {},
    )
    if params.get("condition") != condition:
        problems.append(f"logged condition {params.get('condition')!r} != expected {condition!r}")
    if params.get("scenario") != scenario:
        problems.append(f"logged scenario {params.get('scenario')!r} != expected {scenario!r}")

    return problems


def collect_log(username: str, out_dir: Path, condition: str, scenario: str) -> dict:
    source = LOGS_DIR / f"{username}.jsonl"
    if not source.exists():
        return {"log": None, "events": 0, "problems": ["no log file was written"]}

    dest = out_dir / source.name
    shutil.move(str(source), str(dest))
    events = sum(1 for line in dest.read_text(encoding="utf-8").splitlines() if line.strip())
    return {"log": dest.name, "events": events,
            "problems": check_log(dest, condition, scenario)}


# --------------------------------------------------------------------------
# batch
# --------------------------------------------------------------------------


def parse_run_spec(spec: str) -> set[int]:
    """"1,3-5" -> {1, 3, 4, 5}"""
    wanted: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            wanted.update(range(int(lo), int(hi) + 1))
        else:
            wanted.add(int(part))
    return wanted


def run_one(run, args, out_dir: Path, agent_cwd: Path) -> dict:
    print(f"\n=== run {run.number}: {run.username} "
          f"({run.persona}, condition {run.condition}) ===")

    stale = LOGS_DIR / f"{run.username}.jsonl"
    if stale.exists():
        if not args.force:
            print(f"  SKIPPED: {stale} already exists (use --force to set it aside)")
            return {"status": "skipped", "problems": ["log already existed"]}
        backup = stale.with_suffix(f".jsonl.bak-{int(time.time())}")
        stale.rename(backup)
        print(f"  moved existing log aside -> {backup.name}")

    record: dict = {"started": datetime.now(timezone.utc).isoformat()}
    server = None
    started = time.monotonic()
    try:
        print(f"  starting dev server on :{args.port}")
        server = start_dev_server(args.port, out_dir / f"{run.username}.devserver.log",
                                  args.server_timeout, run.url)
        print("  server ready; launching agent")
        result = run_agent(build_prompt(run), args.model,
                           out_dir / f"{run.username}.agent.jsonl",
                           agent_cwd, args.timeout)
    except Exception as exc:
        print(f"  ERROR: {exc}")
        record.update(status="error", problems=[str(exc)])
        return record
    finally:
        if server is not None:
            kill_tree(server)

    record.update(
        wall_seconds=round(time.monotonic() - started),
        exit_code=result.get("exit_code"),
        num_turns=result.get("num_turns"),
        cost_usd=result.get("total_cost_usd"),
        agent_error=bool(result.get("is_error")) or result.get("subtype") != "success",
    )

    report = result.get("result")
    if isinstance(report, str) and report.strip():
        (out_dir / f"{run.username}.report.md").write_text(report, encoding="utf-8")

    record.update(collect_log(run.username, out_dir, run.condition, run.scenario))
    if record["agent_error"]:
        record["problems"] = ["agent session ended in error"] + record["problems"]
    record["status"] = "ok" if not record["problems"] else "check"

    if record["problems"]:
        print(f"  CHECK ({record['events']} events):")
        for problem in record["problems"]:
            print(f"    - {problem}")
    else:
        cost = record["cost_usd"]
        print(f"  ok: {record['events']} events, {record['wall_seconds']}s"
              + (f", ${cost:.2f}" if isinstance(cost, (int, float)) else ""))
    return record


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--runs", help='which runs to do, e.g. "1", "1,4", "2-5" (default: all)')
    ap.add_argument("--out", type=Path, default=None,
                    help="output directory (default: logs/simulated-data/batch-<timestamp>)")
    ap.add_argument("--prefix", default="sim", help="username prefix (default: sim)")
    ap.add_argument("--start-at", type=int, default=1, help="first run number (default: 1)")
    ap.add_argument("--model", default="claude-opus-5", help="model for the participant agent")
    ap.add_argument("--port", type=int, default=3000)
    ap.add_argument("--timeout", type=float, default=2400, help="per-run agent timeout in seconds")
    ap.add_argument("--server-timeout", type=float, default=180,
                    help="seconds to wait for the dev server")
    ap.add_argument("--pause", action="store_true", help="wait for Enter between runs")
    ap.add_argument("--force", action="store_true",
                    help="set aside an existing logs/<username>.jsonl instead of skipping")
    ap.add_argument("--dry-run", action="store_true", help="print the plan and the first prompt")
    ap.add_argument("-y", "--yes", action="store_true", help="don't ask before starting")
    args = ap.parse_args()

    # Progress lines echo whatever the agent typed, which is rarely pure ASCII;
    # a cp1252 console would otherwise kill the batch mid-run.
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass

    runs = make_runs(prefix=args.prefix, start_at=args.start_at)
    if args.runs:
        wanted = parse_run_spec(args.runs)
        runs = [r for r in runs if r.number in wanted]
    if not runs:
        print("error: no runs selected", file=sys.stderr)
        return 1

    print(f"{len(runs)} run(s), model {args.model}, dev server on :{args.port}")
    for run in runs:
        print(f"  {run.number:>3}  {run.username:<28} {run.persona}")

    if args.dry_run:
        print("\n--- prompt for the first run ---\n")
        print(build_prompt(runs[0]))
        return 0

    if not args.yes:
        try:
            answer = input("\nStart? [y/N] ").strip().lower()
        except EOFError:  # not attached to a terminal
            print("\nerror: refusing to start a billable batch without --yes", file=sys.stderr)
            return 1
        if answer not in {"y", "yes"}:
            return 1

    if port_is_open(args.port):
        print(f"error: something is already listening on :{args.port} — stop it first",
              file=sys.stderr)
        return 1

    out_dir = args.out or (LOGS_DIR / "simulated-data" /
                           f"batch-{datetime.now().strftime('%Y%m%d-%H%M')}")
    out_dir.mkdir(parents=True, exist_ok=True)
    write_manifest(runs, out_dir / "runs.json")

    # The agent works from an empty directory outside the repo so CLAUDE.md and
    # the project's files are never in reach, allowlist or not.
    agent_cwd = out_dir / "agent-cwd"
    agent_cwd.mkdir(exist_ok=True)

    results = []
    results_path = out_dir / "results.json"
    try:
        for index, run in enumerate(runs):
            record = run_one(run, args, out_dir, agent_cwd)
            results.append({"number": run.number, "username": run.username,
                            "persona": run.persona, "condition": run.condition,
                            "scenario": run.scenario, **record})
            results_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
            if args.pause and index < len(runs) - 1:
                try:
                    input("\n  paused - Enter for the next run, Ctrl-C to stop ")
                except EOFError:
                    print("  no terminal to pause on; continuing")
    except KeyboardInterrupt:
        print("\ninterrupted", file=sys.stderr)

    ok = sum(1 for r in results if r.get("status") == "ok")
    costs = [r["cost_usd"] for r in results if isinstance(r.get("cost_usd"), (int, float))]
    print(f"\n{ok}/{len(results)} clean. Logs in {out_dir}")
    if costs:
        print(f"Total cost: ${sum(costs):.2f}")
    for r in results:
        if r.get("status") != "ok":
            print(f"  {r['username']}: {r.get('status')} — {'; '.join(r.get('problems', []))}")
    print(f"\nNext: python scripts/parse_logs.py {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
