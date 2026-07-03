# Scenario design & validation pipeline

Tools for authoring and validating the simulated-colleague scenarios used in the study. The colleague
is a *measurement instrument*: it must answer when asked but never volunteer information or draft the
email (see `../../CLAUDE.md`). This pipeline checks that a scenario's system prompt actually enforces
that behavior.

> ⚠️ These scripts make **billable OpenAI API calls**. They need `OPENAI_API_KEY` in
> `experiment/.env.local`. Run them from the `experiment/` directory.

## Single source of truth

- **`criteria.md`** — the scenario-agnostic behavioral criteria (8 of them). `judge.ts` and `probe.ts`
  parse this file directly; there is no second copy of the criteria in code. Each criterion's slug is
  its title lowercased with non-alphanumerics replaced by `_` (e.g. "Information Gating" →
  `information_gating`).
- **`../../lib/scenarios.json`** — the scenarios themselves. The **colleague model and reasoning
  effort live here** (`chat.model`, `chat.reasoningEffort`), so the live study (`app/api/chat/route.ts`)
  and this pipeline test the *same thing*. Eval-only fields (`analysis`, `chat.probes`) live here too
  and are ignored by the runtime app.

## Phases

```
generate.ts → simulate.ts → judge.ts
                          ↘ probe.ts
```

| Script | Purpose | Command |
|---|---|---|
| `generate.ts` | Draft a scenario JSON from a plain-English situation file | `npx tsx scripts/scenario_design/generate.ts <situation.md> <scenario-id>` |
| `simulate.ts` | Run multi-turn conversations between 4 participant archetypes and the colleague | `npx tsx scripts/scenario_design/simulate.ts <scenario-id> [archetype-id]` |
| `judge.ts` | Score each simulated conversation against every criterion in `criteria.md` | `npx tsx scripts/scenario_design/judge.ts <scenario-id> [archetype-id]` |
| `probe.ts` | Fast single-turn adversarial checks against targeted criteria + latency budget | `npx tsx scripts/scenario_design/probe.ts <scenario-id> [probe-name]` |

Models: the **colleague** uses the model/reasoning from the scenario config; the **participant
simulator** and the **judge** use `gpt-4o`.

### Probes (`probe.ts`)

`probe.ts` replaces the old `scripts/evalColleague.ts`. Each probe seeds the conversation with the
scenario's opening messages, sends one participant message, and judges the reply against only the
criteria that probe targets. It also asserts the reply returned within the production latency budget
(`API_TIMEOUT_MS`, currently 20s — the same timeout the live app aborts at).

- **Generic probes** (in `probe.ts`) are scenario-agnostic: acknowledgments that must not trigger an
  info dump, draft requests that must be refused, vague follow-ups, etc.
- **Scenario-specific probes** live in `scenarios.json` under `chat.probes` — the answerable fact
  questions that exercise `answers_when_asked` (these vary per scenario). Shape:
  `{ "name": "...", "input": "...", "criteria": ["answers_when_asked", "refusal_to_draft"] }`.

## Fixing failures

`judge.ts` and `probe.ts` write agent-readable result files to `outputs/`
(`<scenario-id>_judgments.json`, `<scenario-id>_probes.json`) where each failure carries `evidence`
and `concern`. To fix, point a coding agent at those files and have it revise the scenario's
`systemPromptLines` in `scenarios.json`, then re-run the relevant phase.

## Files

- `criteria.md` — behavioral criteria (single source of truth)
- `archetypes.ts` — the 4 participant personas used by `simulate.ts`
- `generate.ts`, `simulate.ts`, `judge.ts`, `probe.ts` — the phases above
- `situations/` — plain-English situation inputs for `generate.ts`
- `outputs/` — generated scenarios, conversation logs, and judgments (git-ignored working dir)
