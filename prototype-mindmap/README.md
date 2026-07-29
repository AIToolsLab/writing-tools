# Reflective Mind-Map Prototype

A writing-support prototype where the AI helps a user externalize their own
thinking into a node graph. Assistance contracts distinguish grounded reflection
from visibly AI-suggested contribution; every chat-derived structural change is
inert until explicit confirmation and retains its provenance.

Sibling to `prototype-word-bank` (the document-insertion coach); it reuses that
prototype's deterministic-grounding philosophy but externalizes into a mind map
instead of a draft. Uses the repo's `backend/` OpenAI proxy for AI calls.

## Writing Tools launcher

Production builds require a launch from the Writing Tools tool launcher by
default. The launcher passes a short-lived `wt_grant` in the URL fragment; the
mindmap exchanges it for a scoped bearer token and removes the grant from the
URL. Development and test builds remain usable without a launcher token.

```text
VITE_BACKEND_URL=http://localhost:8000/api
VITE_REQUIRE_LAUNCH=false
```

`VITE_REQUIRE_LAUNCH` enables the gate for a development or test build. When it
is unset, the gate is enabled for production builds and disabled for development
and tests. **Production builds always require a launch:** `VITE_REQUIRE_LAUNCH=false`
is ignored when `PROD` is set, so a misconfigured deploy environment cannot ship an
ungated bundle. A grant present in the URL is processed in every mode.

`VITE_BACKEND_URL` is **required** for production builds and throws at startup if
missing. Development and test builds fall back to `http://localhost:8000/api`; a
production bundle carrying that fallback would point every user's browser at their
own machine.

The Writing Tools registry uses `VITE_MINDMAP_TOOL_URL`. Its development default
is `http://localhost:5181/`; its production default is
`https://mindmap.thoughtful-ai.com/`. The existing Playwright smoke suite
continues to use Vite's development server at port 4173, so production-gate
verification remains a separate build check.

## GitHub Pages production build

GitHub Pages hosts only the compiled browser files. Authentication, launch
grants, document snapshots, OpenAI proxying, and token persistence remain on
the Writing Tools backend. The Pages build receives public configuration only;
never provide an OpenAI key, Better Auth secret, database credential, or
`wtk_` token to this build.

Build and verify the exact production artifact with:

```sh
VITE_BACKEND_URL=https://app.thoughtful-ai.com/api \
VITE_REQUIRE_LAUNCH=true \
npm run build
VITE_BACKEND_URL=https://app.thoughtful-ai.com/api npm run verify:pages
npm run test:e2e:pages
```

`verify:pages` requires an HTTPS backend, checks that `dist/index.html` and the
configured backend are present, and refuses published `.env` files. The source
retains its intentional development fallback string, so the production
Playwright suite—not a raw string scan—proves that the built app actually sends
exchange and provider requests to the configured HTTPS backend. It serves that
same `dist` directory with `vite preview`; the normal `test:e2e` command
continues to exercise the development server.

The workflow at `.github/workflows/deploy-mindmap-pages.yml` builds on relevant
pull requests but cannot publish them. A deployment is a manual workflow run
from `main`; selecting any other ref fails without uploading an artifact.
Running the workflow does not configure the repository's Pages settings, DNS,
the production backend, or the Writing Tools tile.

Before the first deployment:

1. Merge and deploy the grant-origin work from
   [#579](https://github.com/AIToolsLab/writing-tools/pull/579), refresh the
   Pages branch from `main`, and unskip the `wt_api` production smoke. It must
   prove that exchange and provider requests use the launching platform's API,
   not the build-time fallback.
2. Land the tool/device-client split and confirm production allowlists contain
   the exact compiled taskpane client plus `mindmap`.
3. Configure this repository's Pages source as **GitHub Actions** and claim
   `mindmap.thoughtful-ai.com`.
4. Ask the DNS owner to create exactly:

   ```text
   CNAME mindmap.thoughtful-ai.com → aitoolslab.github.io
   ```

   Do not append `/writing-tools` or any repository name. DNS cannot carry a
   URL path; GitHub selects the repository from the claimed custom domain and
   the request host.
5. Wait for DNS and TLS provisioning, then enable **Enforce HTTPS**. GitHub
   documents that DNS propagation and availability of HTTPS enforcement can
   each take up to 24 hours, so an initially unavailable HTTPS launch is not
   by itself an application failure.
6. Run the real Word and Google Docs off-origin checks before exposing the
   tile.

Tile rollout belongs to the separate Writing Tools add-in build.
`VITE_ENABLE_MINDMAP_TOOL` is read by
`frontend/src/pages/tools/index.tsx`; it is not part of this Pages build.

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
