# Reflective Mind-Map Prototype

A writing-support prototype where the AI helps a user externalize their own
thinking into a node graph. Assistance contracts distinguish grounded reflection
from visibly AI-suggested contribution; every chat-derived structural change is
inert until explicit confirmation and retains its provenance.

Sibling to `prototype-word-bank` (the document-insertion coach); it reuses that
prototype's deterministic-grounding philosophy but externalizes into a mind map
instead of a draft. Uses the repo's `backend/` OpenAI proxy for AI calls.

## Design principle: typed proposals with deterministic consequences

- **Enforcement (code, not configurable):** a mirror must pass validation before
  it is shown; the AI cannot commit structure (only the user confirms);
  connections must come from user-articulated language; every committed unit
  carries provenance back to the user's words.
- **Factual prompt context:** Source Bank evidence ids, map/draft state, explicit
  UI selection, Think/Map preference, and support controls.

## Provider transport

The established transport remains the default:

```text
VITE_MINDMAP_PROVIDER_TRANSPORT=chat_json
```

The isolated provider-tool path is enabled locally with:

```text
VITE_MINDMAP_PROVIDER_TRANSPORT=responses_tools
VITE_MINDMAP_MODEL=gpt-5.6-terra
VITE_MINDMAP_REASONING_EFFORT=low
```

The Responses transport exposes only `propose_reflection_v1` and
`propose_map_action_v1`. They create reviewable typed proposals; neither tool
confirms or applies a map mutation.

## Enforcement core

The pure validation and gateway modules remain independently unit tested even
though the prototype now includes a UI and provider adapters.

| Module | Role |
| --- | --- |
| `config.ts` | Pointer-validation thresholds, explicit UI pacing, and capability facts. |
| `types.ts` | Domain model: source utterances, candidate thoughts, mirror claims, confirmed reflections, thought units. |
| `normalize.ts` | Normalizer (matches `prototype-word-bank/ownership.ts`) + stopwords + light stemmer. |
| `validator.ts` | **The 3-check mirror validator.** Content overlap, source-span grounding, unsupported-word budget. |
| `stage1-loop.ts` | Typed model orchestration, one repair attempt, and proposal creation. |
| `action-gateway.ts` | Sole deterministic boundary for map-changing actions. |

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
