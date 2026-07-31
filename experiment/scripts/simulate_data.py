"""Per-run setup for agent-simulated study participants.

Builds the run matrix (persona x condition x scenario), a unique username and
study URL for each run, and the prompt to hand the agent. Everything the agent
needs is in the URL, so the prompt never mentions conditions.

    python scripts/simulate_data.py              # print the run plan
    python scripts/simulate_data.py 3            # print the prompt for run 3
    python scripts/simulate_data.py --manifest logs/simulated-data/manifest.json
"""

import argparse
import itertools
import json
import re
import sys
from dataclasses import dataclass, asdict
from urllib.parse import urlencode

BASE_URL = "http://localhost:3000"

# Study 1: amount of AI assistance.
CONDITIONS = ["c", "e", "n"]

# Keys are scenario ids from lib/scenarios.json; values are username-safe slugs.
SCENARIOS = {"roomDoubleBooking": "room", "demoRescheduling": "demo"}

# Study 1 uses roomDoubleBooking only; the other scenario stays available above
# in case it comes back.
DEFAULT_SCENARIOS = ["roomDoubleBooking"]

# The study flow starts at consent, which redirects to an external Qualtrics
# form. Simulated participants skip it and start at the intro page instead.
START_PAGE = "intro"

USERNAME_RE = re.compile(r"^[a-zA-Z0-9\-_]+$")

personas = {
  "engaged": {
    "name": "Fully engaged",
    "description": "You are fully engaged with the task, but not anxious about it. You read the instructions thoroughly before starting. You ask the colleague specific questions needed to write a correct email (all the facts the reader would need). Ask a couple questions at a time during the drafting process. If the AI sidebar is present, you read the suggestions and use the parts that fit, but rework them in your own words and drop any information inconsistent with what you learned from the colleague. Read sidebar suggestions and ask questions DURING THE DRAFTING PROCESS. When you have all the information you need, stop asking the colleague questions. When you think your email is complete, check it over once before sending."
  },
  "anxious": {
    "name": "Anxious",
    "description": "You are fully engaged with the task, but anxious about the quality of your work. You lean heavily on AI tools. If the sidebar is present, you treat it as the authority on what to write. Accept suggestions close to verbatim and make your own decisions about what to write rarely if ever. Lean on the colleague chat as well, especially if the sidebar is not present. You would rather be told what to say than think about what the email needs. You can ask some questions about required information, but most should tend toward 'Does this sound right?' or 'What should I say in the email?' rather than fact-finding. You re-read and second guess the email multiple times before sending and defer to whatever the AI tools produce over what you produce."
  },
  "unconcerned": {
    "name": "Unconcerned",
    "description": "You are unconcerned with the task and wants to complete it as fast as possible. You are not concerned about quality. You maintain the level of professionalism expected from a typical adult (and are NOT hostile towards the colleague chat), but are otherwise disengaged and not very reflective. You skim the instructions and mostly ignore the colleague chat. You rarely ask the colleague questions, even when you're missing information that may be needed to make the email accurate, and you may not read the response closely. You largely ignore the AI sidebar (when it is present), glancing at it at most. Don't read anything carefully. Your write a short, generic email from whatever you happen to absorb. Don't re-read it and send it as soon as you have a complete draft. You answer all survey questions, but quickly and without much reflection."
  }
}

prompt_main = "You are a participant in study #1. You must complete all steps of the study pipeline with the exception of the informed-consent form. This includes reading instructions and filling out all surveys. The task ends when you see the final page. Use Playwright MCP tools to interact with the UI directly. Use locator.pressSequentially(text, { delay: 180 }) to type at a realistic speed (about 5-6 chars per second). Never use fill() or set values via JS. Don't log your thought process and NEVER make meta-commentary about being an AI. You only know what's onscreen. Do not read project files or call app APIs. If something goes wrong, stop and report what happened (no debugging, fixing, or retrying)."


@dataclass
class Run:
    """One simulated participant."""

    number: int
    persona: str
    condition: str
    scenario: str
    username: str
    url: str


def make_username(number, persona, condition, scenario, prefix="sim"):
    """Username for run `number`, e.g. "sim-03-room-c-anxious".

    This is also the log filename (logs/<username>.jsonl), so it has to match
    the app's /^[a-zA-Z0-9\\-_]+$/ check.
    """
    name = f"{prefix}-{number:02d}-{SCENARIOS[scenario]}-{condition}-{persona}"
    if not USERNAME_RE.match(name):
        raise ValueError(f"username has characters the study app rejects: {name!r}")
    return name


def make_url(username, condition, scenario, page=START_PAGE, base=BASE_URL, **extra):
    """Study URL for one run. `extra` passes through params like ch=0."""
    if condition not in CONDITIONS:
        raise ValueError(f"unknown condition {condition!r}; expected one of {CONDITIONS}")
    if scenario not in SCENARIOS:
        raise ValueError(f"unknown scenario {scenario!r}; expected one of {list(SCENARIOS)}")

    params = {
        "page": page,
        "username": username,
        "condition": condition,
        "scenario": scenario,
        **extra,
    }
    return f"{base}/study?{urlencode(params)}"


def make_runs(persona_ids=None, conditions=None, scenarios=None, prefix="sim",
              start_at=1, **url_extra):
    """The full run matrix, numbered in the order they should be run.

    Numbering follows scenario -> condition -> persona, so run numbers shift if
    you change the matrix. Use `start_at` for a follow-up batch so its usernames
    don't collide with logs you already have.
    """
    persona_ids = persona_ids or list(personas)
    conditions = conditions or CONDITIONS
    scenarios = scenarios or DEFAULT_SCENARIOS

    runs = []
    combos = itertools.product(scenarios, conditions, persona_ids)
    for i, (scenario, condition, persona) in enumerate(combos, start=start_at):
        username = make_username(i, persona, condition, scenario, prefix)
        runs.append(
            Run(
                number=i,
                persona=persona,
                condition=condition,
                scenario=scenario,
                username=username,
                url=make_url(username, condition, scenario, **url_extra),
            )
        )
    return runs


def build_prompt(run):
    """The complete prompt for one run: task rules, persona, and the URL."""
    return (
        f"{prompt_main}\n\n"
        f"Persona ({personas[run.persona]['name']}):\n"
        f"{personas[run.persona]['description']}\n\n"
        f"Start here: {run.url}"
    )


def write_manifest(runs, path):
    """Record which persona produced which log.

    Nothing in the JSONL identifies the persona — the logged studyParams only
    carry condition and scenario — so this file is what lets the analysis join
    persona onto each participant row.
    """
    with open(path, "w", encoding="utf-8") as fh:
        json.dump([asdict(r) for r in runs], fh, indent=2)
        fh.write("\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run", nargs="?", type=int, help="print the prompt for this run number")
    ap.add_argument("--prefix", default="sim", help="username prefix (default: sim)")
    ap.add_argument("--start-at", type=int, default=1, help="first run number (default: 1)")
    ap.add_argument("--manifest", help="write the run matrix to this JSON file")
    args = ap.parse_args()

    runs = make_runs(prefix=args.prefix, start_at=args.start_at)

    if args.run is not None:
        match = next((r for r in runs if r.number == args.run), None)
        if match is None:
            print(f"error: no run {args.run} (have {runs[0].number}-{runs[-1].number})",
                  file=sys.stderr)
            return 1
        print(build_prompt(match))
        return 0

    for r in runs:
        print(f"{r.number:>3}  {r.username:<28}  {r.url}")
    if args.manifest:
        write_manifest(runs, args.manifest)
        print(f"\nWrote {len(runs)} runs to {args.manifest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
