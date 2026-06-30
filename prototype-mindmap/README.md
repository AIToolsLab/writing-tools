# Reflective Mind-Map Prototype

A writing-support prototype where the AI helps a user externalize their own
thinking into a node graph — **without ever authoring the structure itself**.
The AI questions, mirrors the user's own words back, and captures confirmed
structure. The user remains the author of every idea, node, hierarchy, and
connection.

Sibling to `prototype-uist` (the document-insertion coach); it reuses that
prototype's deterministic-grounding philosophy but externalizes into a mind map
instead of a draft. Uses the repo's `backend/` OpenAI proxy for AI calls.

## Design principle: enforcement in code, calibration in config

- **Enforcement (code, not configurable):** a mirror must pass validation before
  it is shown; the AI cannot commit structure (only the user confirms);
  connections must come from user-articulated language; every committed unit
  carries provenance back to the user's words.
- **Calibration (`src/config.ts`):** thresholds, weights, pacing — everything we
  expect to tune while running sessions. Not user-facing yet.

## Milestone 0 — headless enforcement core (this folder)

No UI, no LLM, no network. Pure, unit-tested functions that prove the hardest
part works before anything is wired up.

| Module | Role |
| --- | --- |
| `config.ts` | All calibration values (mirror thresholds, readiness, pacing). |
| `types.ts` | Domain model: source utterances, candidate thoughts, mirror claims, confirmed reflections, thought units. |
| `normalize.ts` | Normalizer (matches `prototype-uist/ownership.ts`) + stopwords + light stemmer. |
| `validator.ts` | **The 3-check mirror validator.** Content overlap, source-span grounding, unsupported-word budget. |
| `readiness.ts` | Whether a candidate may be mirrored yet (spontaneous-vs-prompted weighting; hierarchy hard rule). |
| `signals.ts` | Detects containment/relation language and flags spontaneous vs. prompted. |

The three validator checks, coarsest to finest:

1. **Content overlap** — are the reflection's content words the user's words?
2. **Source-span grounding** — does every claim trace to a user utterance that
   actually supports it? (Catches new *relationships* assembled from real words.)
3. **Unsupported words** — are stray new content words under budget? (Catches a
   single meaning-shifting insertion like "central" that the average let through.)

When any check fails the mirror is blocked and the AI must fall back to a
clarifying question, targeted at the weakest span.

## Roadmap

- **M0** — enforcement core (here).
- **M1** — minimal chat loop wired to the backend OpenAI proxy: Question →
  Mirror (gated) → Clarify.
- **M2** — `@xyflow/react` mind-map surface; confirmed chunks become thought
  units with provenance; AI proposals are "pending" until confirmed.
- **M3** — thought-unit role changes (content ⇄ sub-node), connections, direct
  user editing with symmetric primitives.

## Test

```sh
npm install
npm test
```
