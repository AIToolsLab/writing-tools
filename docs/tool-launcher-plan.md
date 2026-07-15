# Extensible Tool Launcher Plan

Design exploration for turning the sidebar into a launch point for external
writing tools (first-party prototypes now, community research tools later),
without merging them into the add-in or supporting them as first-class
features.

> **Status:** Exploration/proposal. Nothing here is implemented. Depends on
> the Better Auth integration described in `auth-plan.md` actually being
> enforced on the proxy routes (it currently is not).

## Motivating examples

- The mindmap prototype on `feat/uist`: a full-page, client-side-only app
  that uses the backend only for OpenAI access. It has a draft-editing
  surface but that's not its main UI. It does not fit the taskpane shape.
- Future: external researchers running longitudinal writing studies on our
  deployment ("bring your tool, we provide auth + LLM proxy + logging +
  document access"), without each of them re-doing app-store approval,
  login infrastructure, and log plumbing.

## What the platform actually provides

Strip the idea to its parts and the sidebar-as-launcher is really a small
**platform API** with four services. Every writing-study prototype we've
built needs exactly these:

1. **Identity** — who is this participant? (Better Auth session)
2. **LLM proxy** — OpenAI-compatible endpoint, server-held key, usage
   attributed to the user (and eventually to the tool/study).
3. **Event logging** — `POST /api/log` JSONL study logs, keyed by user
   (and eventually by tool/study for multi-tenant export).
4. **Document access** — read (and optionally write) the writer's current
   Word/Google Docs document, which only the taskpane can reach via
   Office.js.

The launcher UI in the sidebar is the thin part; the contract above is the
real deliverable. Naming it explicitly (e.g. "Platform API v0") keeps us
honest about what external tools may depend on.

## Where the tool runs: browser tab, not iframe (mostly)

Two candidate execution surfaces:

### A. Iframe inside the taskpane

- Taskpane is ~350px wide; anything that didn't fit the "sidebar shape"
  to begin with (the whole premise) won't fit here either.
- Office webviews (especially Windows WebView2 / older Trident fallbacks)
  add compatibility pain for arbitrary third-party code.
- Sandboxing is *possible* (`sandbox="allow-scripts"` **without**
  `allow-same-origin` gives an opaque origin, so the frame can't touch our
  cookies/localStorage even if we serve the bundle ourselves), but hosting
  user-uploaded bundles safely means a separate sandbox origin (the
  `*.usercontent.example.com` pattern used by Google/Claude artifacts).
  That's real infrastructure for little benefit at taskpane size.

**Verdict:** keep iframes as a *future* option for small widgets; not the
main mechanism.

### B. Launch in the user's main browser (recommended)

- Full-page apps get a full page. The mindmap works as-is.
- The tool runs on **its own origin** (researcher-hosted: GitHub Pages,
  their university server, wherever). Nothing executes on our origin, so
  the same-origin-code problem disappears entirely. Our security question
  reduces to the classic OAuth one: *what can the token do, and what data
  did we hand over?* That's a much better-understood problem.
- Office taskpanes can open external browser windows
  (`Office.context.ui.openBrowserWindow`, or a plain anchor — behavior
  varies by host; desktop Word opens the system browser).
- Cost: no direct channel between the tool tab and the taskpane webview —
  document access must be brokered through the backend (below).

## Connection lifecycle: how the tool gets access

### Auth: the device flow is already the right primitive

`backend/src/auth.ts` already runs Better Auth's `deviceAuthorization`
plugin (RFC 8628) with a per-client allowlist (`validateClient` against
`BETTER_AUTH_DEVICE_CLIENT_IDS`), and `frontend/src/api/deviceAuth.ts`
proves the token-only path (`credentials: 'omit'` throughout, Bearer only,
no cookies). An external tool is structurally identical to the add-in
itself: an app on a foreign origin that needs a token for our API.

So **each registered tool gets a `client_id` in the device allowlist** and
can independently do the device flow. No secrets ship in the tool, no CORS
gymnastics (bearer + no cookies means permissive CORS is actually fine for
these routes), and revocation = revoke the Better Auth session.

Friction shortcut for tools launched *from the sidebar* (where the user is
already signed in): the taskpane mints a **launch grant** —

1. Taskpane: `POST /api/handoff` (authenticated) →
   `{ grant_id }`, stashing `{ user, tool_client_id, scopes, doc_snapshot?, ttl≈2min, single-use }`.
2. Taskpane opens `https://tool.example/#wt_grant=<grant_id>` in the
   browser. URL **fragment**, not query: fragments aren't sent to the
   tool's server or logged in intermediary access logs.
3. Tool: `POST /api/handoff/exchange {grant_id}` → bearer token
   (a Better Auth session scoped/tagged for that tool) + the doc snapshot.

The pure device flow remains the fallback when a tool is opened directly
(bookmark, returning participant), which longitudinal studies will need
anyway.

Teardown: grants are single-use with a short TTL; tokens expire on the
normal session schedule; a "Disconnect" row per tool in the sidebar calls
Better Auth session revocation. Nothing needs the taskpane to stay open
after launch *unless* a live document channel is granted (below).

### Prerequisite: the proxy must actually check tokens

Today `/api/openai/chat/completions` and `/api/log` are unauthenticated
(`auth-plan.md` documents this). "Proxy access under their account" is
meaningless until the backend:

- requires a valid Bearer session on `/api/openai/*` and `/api/log`;
- attributes each call to `(user, client_id)` — which also gives research
  provenance ("which tool generated this completion") for free;
- (later) enforces per-user/per-tool quotas before third parties arrive.

This is the first implementation step regardless of everything else.

## Document access: brokered, snapshot-first

Only the taskpane can touch Office.js, so the tool never gets direct
document access; the question is how the taskpane brokers it. The existing
`EditorAPI` interface (`getDocContext`, `selectPhrase`, selection-change
events) and the `DocContext` shape (`beforeCursor` / `selectedText` /
`afterCursor`) are the natural RPC surface.

### v1: snapshot handoff (read-only)

At launch, the taskpane includes the current `DocContext` in the handoff
stash; the tool receives it on grant exchange. Optionally a
`GET /api/handoff/:id/doc` re-fetch while the grant lives.

- Covers the mindmap case and most reflection/analysis prototypes.
- No persistent connection, no teardown problem, trivially auditable
  ("this tool received a copy of your document at 14:32").

### v2: live channel (read-write, opt-in per launch)

Backend relay: the taskpane holds a WebSocket (or SSE + POST) to a
per-grant channel; the tool sends `EditorAPI`-shaped RPCs
(`getDocContext`, `selectPhrase`, `insertText`, …) with its bearer token;
the backend forwards to the taskpane, which executes against Office.js and
replies. Scopes on the grant (`doc:read` vs `doc:write`) gate which RPCs
the relay forwards.

- Write access should default to **patch-with-confirm**: the tool proposes
  an edit, the sidebar shows it, the writer applies it. Direct silent
  writes only for trusted first-party tools.
- Channel lifetime = taskpane lifetime; taskpane close tears the channel
  down and the tool sees a clean `disconnected` event. This is the honest
  answer to "how do we tear it down": the relay makes disconnect explicit
  instead of a dangling opener/postMessage reference.

## Registration UX

Keep it far short of an app store:

- **Phase 1:** hardcoded first-party list (mindmap, …) on a new "Tools"
  page in the sidebar (`PageName.Tools` next to Chat/Draft/Revise), plus a
  "paste a URL" field for ad-hoc launches.
- **Later:** a tool manifest — small JSON (name, launch URL, requested
  scopes, contact) fetched from `<tool-origin>/.well-known/writing-tool.json`
  or pasted. Requested scopes drive a consent screen ("Mindmap wants:
  LLM access, read your document"). For community studies this consent
  screen is also where IRB-relevant disclosure lives.
- **Drag-and-drop bundle hosting: defer.** Hosting arbitrary uploaded
  bundles is the single riskiest piece (needs a dedicated sandbox origin,
  CSP, storage isolation) and researcher-hosted URLs cover the need. If it
  ever lands, serve bundles from a separate domain with
  `sandbox="allow-scripts"` (no `allow-same-origin`) framing or as the
  browser-tab origin itself — never from the app origin.

## Security posture (first pass vs. eventually)

Fine to skip for first-party-only Phase 1, but designed-for now:

| Concern | v1 (first-party) | Service-for-researchers |
| --- | --- | --- |
| Token power | full session token | scoped tokens (`openai:chat`, `log:write`, `doc:read`, `doc:write`), short expiry, per-tool tagging |
| Proxy abuse | auth required | per-user + per-tool quotas/rate limits; model allowlist |
| Doc data leaving trust boundary | trusted tools | consent screen naming scopes; snapshot-only default; patch-with-confirm writes |
| Same-origin code execution | avoided by design (browser launch) | stays avoided; sandbox origin if bundle hosting ever lands |
| Log tenancy | shared JSONL as today | logs keyed `(user, tool)`; per-study export scoped to the study's own logs |
| Revocation | session revoke via sidebar | plus grant audit list ("connected tools") |

Also worth stating: permissive CORS is *compatible* with the bearer-token
model (no cookies to steal cross-site), but cookie-authenticated routes
(`/api/auth/*` browser flows) must keep relying on Better Auth's
`trustedOrigins` and never be callable with ambient credentials from tool
origins.

## Phasing

1. **Phase 0 (prereq):** enable Better Auth in production per
   `auth-plan.md`; require Bearer on `/api/openai/*` and `/api/log`;
   attribute logs/usage to the session user.
2. **Phase 1:** "Tools" page in the sidebar; hardcoded tool list + URL
   field; browser launch with handoff grant (token + read-only doc
   snapshot); mindmap ported to consume it. Device-flow fallback for
   direct visits.
3. **Phase 2:** live doc channel over a backend relay with `doc:read` /
   `doc:write` scopes and patch-with-confirm writes.
4. **Phase 3 (community service):** scoped tokens, quotas, manifest
   registration + consent screens, per-study log tenancy and export.
