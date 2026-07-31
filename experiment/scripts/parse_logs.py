#!/usr/bin/env python3
"""Turn study JSONL logs into human-readable per-participant transcripts.

The raw logs are dominated by keystroke-level `documentUpdate` events (hundreds
per session). This script collapses those into "typing bursts" and interleaves
them with chat messages, AI suggestions, and survey responses on a single
chronological timeline.

Usage:
    python scripts/parse_logs.py logs/simulated-data/pilot-attempt
    python scripts/parse_logs.py logs/simulated-data/pilot-attempt --out /tmp/readable
    python scripts/parse_logs.py logs/foo.jsonl --format text
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

CONDITION_NAMES = {
    "n": "no_ai (baseline)",
    "c": "complete_document",
    "e": "example_sentences",
    "a": "analysis_readerPerspective",
    "p": "proposal_advice",
}

# A gap this long (seconds) between consecutive documentUpdates splits one
# typing burst into two, so pauses in composition stay visible.
BURST_GAP_SECONDS = 20.0


# --------------------------------------------------------------------------
# parsing
# --------------------------------------------------------------------------


@dataclass
class Event:
    event: str
    timestamp: datetime
    extra: dict
    raw: dict


@dataclass
class Entry:
    """One line on the readable timeline."""

    time: datetime
    kind: str
    title: str
    body: str = ""
    end_time: datetime | None = None
    meta: dict = field(default_factory=dict)


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def load_events(path: Path) -> list[Event]:
    events: list[Event] = []
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as exc:
            print(f"  warning: {path.name}:{lineno} unparseable ({exc})", file=sys.stderr)
            continue
        ts = raw.get("timestamp")
        if not ts:
            continue
        events.append(
            Event(
                event=raw.get("event", "?"),
                timestamp=parse_ts(ts),
                extra=raw.get("extra_data") or {},
                raw=raw,
            )
        )
    events.sort(key=lambda e: e.timestamp)
    return events


def doc_text(extra: dict) -> str:
    state = extra.get("editorState") or {}
    return (
        state.get("beforeCursor", "")
        + state.get("selectedText", "")
        + state.get("afterCursor", "")
    )


def describe_delta(before: str, after: str) -> str:
    """Human-readable summary of the change from `before` to `after`."""
    if before == after:
        return "(no change to body text)"

    # Trim the shared head and tail so only the changed span is described.
    head = 0
    while head < len(before) and head < len(after) and before[head] == after[head]:
        head += 1
    tail = 0
    while (
        tail < len(before) - head
        and tail < len(after) - head
        and before[len(before) - 1 - tail] == after[len(after) - 1 - tail]
    ):
        tail += 1

    removed = before[head : len(before) - tail]
    added = after[head : len(after) - tail]

    parts = []
    if added:
        parts.append(f"+ {json_snippet(added)}")
    if removed:
        parts.append(f"- {json_snippet(removed)}")
    return "\n".join(parts)


def json_snippet(text: str, limit: int = 600) -> str:
    if len(text) > limit:
        text = text[:limit] + f"… [{len(text)} chars total]"
    return text.replace("\n", "\n  ")


# --------------------------------------------------------------------------
# timeline construction
# --------------------------------------------------------------------------


def build_timeline(events: list[Event]) -> tuple[list[Entry], dict]:
    entries: list[Entry] = []
    session: dict = {"surveys": {}, "final": {}, "params": {}}

    pending_requests: dict[str, Event] = {}
    burst: list[Event] = []
    text_before_burst = ""

    def flush_burst() -> None:
        nonlocal burst, text_before_burst
        if not burst:
            return
        last = burst[-1]
        after = doc_text(last.extra)
        entries.append(
            Entry(
                time=burst[0].timestamp,
                end_time=last.timestamp,
                kind="typing",
                title=(
                    f"WRITING ({len(burst)} edits, "
                    f"{(last.timestamp - burst[0].timestamp).total_seconds():.0f}s)"
                ),
                body=describe_delta(text_before_burst, after),
                meta={
                    "subject": last.extra.get("subject", ""),
                    "wordCount": last.extra.get("wordCount"),
                    "text": after,
                },
            )
        )
        text_before_burst = after
        burst = []

    for ev in events:
        name = ev.event

        if name == "documentUpdate":
            if burst and (ev.timestamp - burst[-1].timestamp).total_seconds() > BURST_GAP_SECONDS:
                flush_burst()
            burst.append(ev)
            continue

        if name.startswith("aiRequest:"):
            # Requests aren't rendered on their own (they pair with the response),
            # so they must not chop a burst of continuous writing in half.
            pending_requests[name.split(":", 1)[1]] = ev
            continue

        # Anything else that isn't an edit interrupts the current burst.
        flush_burst()

        params = ev.extra.get("studyParams")
        if params:
            session["params"].update(params)

        if name == "Started Study":
            session["client"] = ev.extra

        elif name.startswith("chatMessage:"):
            role = name.split(":", 1)[1]
            who = "YOU" if role == "user" else "COLLEAGUE"
            entries.append(
                Entry(
                    time=ev.timestamp,
                    kind=f"chat-{role}",
                    title=f"{who}",
                    body=ev.extra.get("content", ""),
                )
            )

        elif name.startswith("aiResponse:"):
            gen_type = name.split(":", 1)[1]
            req = pending_requests.pop(gen_type, None)
            generation = ev.extra.get("generation") or {}
            auto = ev.extra.get("isAutoRefresh")
            latency = (
                f", {(ev.timestamp - req.timestamp).total_seconds():.1f}s"
                if req is not None
                else ""
            )
            entries.append(
                Entry(
                    time=ev.timestamp,
                    kind="ai",
                    title=(
                        f"AI SUGGESTION [{gen_type}] "
                        f"({'auto-refresh' if auto else 'user-requested'}{latency})"
                    ),
                    body=generation.get("result", "") or "(empty)",
                    meta={
                        "historyMessages": ev.extra.get("conversationHistoryMessageCount"),
                        "docAtRequest": doc_text(ev.extra),
                    },
                )
            )

        elif name.startswith("surveyComplete:"):
            which = name.split(":", 1)[1]
            session["surveys"][which] = ev.extra
            entries.append(
                Entry(time=ev.timestamp, kind="survey", title=f"SURVEY COMPLETE: {which}")
            )

        elif name == "taskStart":
            session["taskStart"] = ev.timestamp
            entries.append(Entry(time=ev.timestamp, kind="marker", title="TASK START"))

        elif name == "taskComplete":
            session["taskEnd"] = ev.timestamp
            session["final"] = ev.extra
            entries.append(Entry(time=ev.timestamp, kind="marker", title="TASK COMPLETE"))

        elif name.startswith("view:"):
            entries.append(
                Entry(time=ev.timestamp, kind="view", title=f"page: {name.split(':', 1)[1]}")
            )

        else:
            entries.append(Entry(time=ev.timestamp, kind="other", title=name))

    flush_burst()

    if events:
        session["start"] = events[0].timestamp
        session["end"] = events[-1].timestamp
    return entries, session


def summarize(name: str, events: list[Event], entries: list[Entry], session: dict) -> dict:
    params = session.get("params", {})
    task_start = session.get("taskStart")
    task_end = session.get("taskEnd")
    final = session.get("final", {})

    user_msgs = [e for e in entries if e.kind == "chat-user"]
    ai_entries = [e for e in entries if e.kind == "ai"]

    return {
        "participant": name,
        "condition": params.get("condition", ""),
        "condition_name": CONDITION_NAMES.get(params.get("condition", ""), ""),
        "scenario": params.get("scenario", ""),
        "wave": events[0].raw.get("wave", "") if events else "",
        "events": len(events),
        "questions_asked": len(user_msgs),
        "ai_suggestions_shown": len(ai_entries),
        "typing_bursts": sum(1 for e in entries if e.kind == "typing"),
        "task_seconds": round((task_end - task_start).total_seconds()) if task_start and task_end else "",
        "session_seconds": (
            round((session["end"] - session["start"]).total_seconds())
            if session.get("start") and session.get("end")
            else ""
        ),
        "final_word_count": final.get("wordCount", ""),
        "final_subject": final.get("subject", ""),
    }


# --------------------------------------------------------------------------
# rendering
# --------------------------------------------------------------------------


def rel(t: datetime, origin: datetime) -> str:
    secs = int((t - origin).total_seconds())
    return f"{secs // 60:02d}:{secs % 60:02d}"


def render_survey(rows: dict, heading: str, md: bool) -> list[str]:
    if not rows:
        return []
    out = [f"### {heading}" if md else f"{heading}", ""]
    if md:
        out += ["| Question | Response |", "| --- | --- |"]
        for k, v in rows.items():
            if isinstance(v, list):
                v = ", ".join(str(x) for x in v)
            v = str(v).replace("\n", " ").replace("|", "\\|")
            out.append(f"| `{k}` | {v} |")
    else:
        for k, v in rows.items():
            if isinstance(v, list):
                v = ", ".join(str(x) for x in v)
            out.append(f"  {k}: {str(v)!r}")
    out.append("")
    return out


def render(name: str, entries: list[Entry], session: dict, summary: dict, md: bool,
           show_snapshots: bool) -> str:
    origin = session.get("start") or (entries[0].time if entries else datetime.now())
    h1, h2 = ("# ", "## ") if md else ("", "")
    lines: list[str] = []

    lines.append(f"{h1}{name}")
    lines.append("")
    facts = [
        ("Condition", f"{summary['condition']} — {summary['condition_name']}"),
        ("Scenario", summary["scenario"]),
        ("Wave", summary["wave"]),
        ("Started", origin.isoformat()),
        ("Task duration", f"{summary['task_seconds']}s"),
        ("Session duration", f"{summary['session_seconds']}s"),
        ("Questions asked of colleague", summary["questions_asked"]),
        ("AI suggestions shown", summary["ai_suggestions_shown"]),
        ("Final email", f"{summary['final_word_count']} words"),
        ("Raw events", summary["events"]),
    ]
    if md:
        lines += ["| | |", "| --- | --- |"]
        lines += [f"| **{k}** | {v} |" for k, v in facts]
    else:
        lines += [f"  {k}: {v}" for k, v in facts]
    lines.append("")

    lines += render_survey(session["surveys"].get("intro-survey", {}), "Intro survey", md)

    lines.append(f"{h2}Timeline")
    lines.append("")
    lines.append("_Times are mm:ss from the first event._" if md else "(times are mm:ss from first event)")
    lines.append("")

    for e in entries:
        if e.kind == "view":
            continue  # page views are noise next to the phase markers

        stamp = rel(e.time, origin)
        if e.end_time is not None:
            stamp = f"{stamp}–{rel(e.end_time, origin)}"

        if md:
            lines.append(f"**`{stamp}`  {e.title}**")
            lines.append("")
            if e.kind == "typing":
                subj = e.meta.get("subject")
                if subj:
                    lines.append(f"Subject line: `{subj}`  ({e.meta.get('wordCount')} words)")
                    lines.append("")
                lines.append("```diff")
                lines.append(e.body)
                lines.append("```")
                if show_snapshots:
                    lines.append("<details><summary>document at this point</summary>")
                    lines.append("")
                    lines.append("```")
                    lines.append(e.meta.get("text", ""))
                    lines.append("```")
                    lines.append("")
                    lines.append("</details>")
            elif e.body:
                lines += ["> " + ln for ln in e.body.split("\n")]
            lines.append("")
        else:
            lines.append(f"[{stamp}] {e.title}")
            if e.body:
                lines += ["    " + ln for ln in e.body.split("\n")]
            lines.append("")

    final = session.get("final", {})
    if final.get("finalText"):
        lines.append(f"{h2}Final email")
        lines.append("")
        lines.append(f"**Subject:** {final.get('subject', '')}" if md else f"Subject: {final.get('subject', '')}")
        lines.append("")
        if md:
            lines.append("```")
        lines.append(final["finalText"])
        if md:
            lines.append("```")
        lines.append("")

    lines += render_survey(session["surveys"].get("post-task-survey", {}), "Post-task survey", md)
    return "\n".join(lines) + "\n"


def render_index(summaries: list[dict]) -> str:
    cols = [
        ("participant", "Participant"),
        ("condition", "Cond"),
        ("scenario", "Scenario"),
        ("questions_asked", "Questions"),
        ("ai_suggestions_shown", "AI sugg."),
        ("task_seconds", "Task (s)"),
        ("final_word_count", "Words"),
        ("events", "Events"),
    ]
    lines = ["# Pilot log summary", "", "| " + " | ".join(h for _, h in cols) + " |",
             "| " + " | ".join("---" for _ in cols) + " |"]
    for s in summaries:
        cells = []
        for key, _ in cols:
            val = s[key]
            if key == "participant":
                val = f"[{val}]({val}.md)"
            cells.append(str(val))
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    return "\n".join(lines)


# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path", type=Path, help="a .jsonl log file or a directory of them")
    ap.add_argument("--out", type=Path, default=None,
                    help="output directory (default: <path>/readable)")
    ap.add_argument("--format", choices=["markdown", "text"], default="markdown")
    ap.add_argument("--snapshots", action="store_true",
                    help="include a collapsed full-document snapshot after each typing burst")
    ap.add_argument("--stdout", action="store_true",
                    help="print to stdout instead of writing files (single file only)")
    args = ap.parse_args()

    if args.path.is_dir():
        files = sorted(args.path.glob("*.jsonl"))
    elif args.path.is_file():
        files = [args.path]
    else:
        print(f"error: {args.path} not found", file=sys.stderr)
        return 1
    if not files:
        print(f"error: no .jsonl files in {args.path}", file=sys.stderr)
        return 1

    md = args.format == "markdown"
    ext = "md" if md else "txt"
    out_dir = args.out or (args.path if args.path.is_dir() else args.path.parent) / "readable"

    if not args.stdout:
        out_dir.mkdir(parents=True, exist_ok=True)

    summaries = []
    for path in files:
        name = path.stem
        events = load_events(path)
        if not events:
            print(f"  skipped {name}: no events", file=sys.stderr)
            continue
        entries, session = build_timeline(events)
        summary = summarize(name, events, entries, session)
        summaries.append(summary)
        text = render(name, entries, session, summary, md, args.snapshots)

        if args.stdout:
            print(text)
        else:
            dest = out_dir / f"{name}.{ext}"
            dest.write_text(text, encoding="utf-8")
            print(f"  {name}: {len(events)} events -> {dest.name}")

    if not args.stdout and summaries:
        (out_dir / f"index.{ext}").write_text(render_index(summaries), encoding="utf-8")
        with (out_dir / "summary.csv").open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=list(summaries[0].keys()))
            writer.writeheader()
            writer.writerows(summaries)
        print(f"\nWrote {len(summaries)} transcripts + index.{ext} + summary.csv to {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
