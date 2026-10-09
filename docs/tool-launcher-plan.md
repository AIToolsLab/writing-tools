# Extensible Tool Launcher Plan

Design exploration for turning the sidebar into a launch point for external
writing tools (first-party prototypes now, community research tools later),
without merging them into the add-in or supporting them as first-class
features.

> See also [prompt-packs-plan.md](prompt-packs-plan.md): the tier *below*
> hosted tools — extensions as declarative prompt packs that need none of the
> grant/manifest machinery here. Most sidebar-shaped concepts belong there;
> this plan covers what outgrows it (own rendering surface or transport).

> **Status:** Phases 0 and 1 are implemented; Phases 2+ remain proposal.
> Implemented so far:
> - **Phase 0** — the proxy and `/api/log` already require a Bearer session and
>   fail closed for sessionless traffic (this predated the launcher work). On top
>   of that, every metered request and log line now carries a `client_id`
>   attributing it to `(user, tool)`: external tools via their grant token, the
>   first-party add-in via an allowlisted `X-Client-Id` header, null otherwise.
>   See `backend/src/openaiProxy.ts`, `usage.ts` (`llm_usage.client_id`, db v2),
>   `logging.ts`, and `app.ts` `resolveUser`.
> - **Phase 1** — the handoff grant flow (`backend/src/toolGrants.ts`, `tool_grant`
>   table db v3; routes `POST /api/handoff`, `/api/handoff/exchange`,
>   `GET /api/handoff/doc`, `POST /api/handoff/revoke`) and a "Tools" page in the
>   sidebar (`frontend/src/pages/tools/`, `PageName.Tools`) that launches a
>   registered tool in the browser with a token + read-only doc snapshot, plus a
>   paste-a-URL field for device-flow tools. One deviation from the sketch below:
>   the tool's bearer token is our own opaque `wtk_` credential (a `tool_grant`
>   row), not a Better Auth session — Better Auth has no server-side session-mint
>   primitive, and a parallel token keeps the tool's scopes and per-token revoke
>   explicit. Revocation is per-token, not Better Auth session revocation.
>
> Everything below Phase 1 (rooms, panel tools, scoped tokens/quotas/manifests) is
> still exploration. Scope enforcement on tool tokens is deferred to Phase 3: a
> valid tool token is currently treated as a full session token, except the doc
> re-fetch, which requires `doc:read`.

## Motivating examples

- The mindmap prototype on `feat/uist`: a full-page, client-side-only app
  that uses the backend only for OpenAI access. It has a draft-editing
  surface but that's not its main UI. It does not fit the taskpane shape.
- A phone surface for a prototype — e.g. voice interaction with the
  document that's open on the desktop. Same platform contract, but the
  connection is device↔document rather than tab↔taskpane, which motivates
  the room model below.
- Prototypes that *are* taskpane-shaped and should appear inside the
  sidebar without being merged into the add-in bundle (see "Taskpane-shaped
  tools" below).
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

### Prerequisite: the proxy must actually check tokens — done

`/api/openai/*` and `/api/log` require a valid Bearer session and fail closed for
sessionless traffic (`app.ts` `resolveUser`, `openaiProxy.ts` `attributeRequest`).
Each call is attributed to `(user, client_id)`: the `client_id` is the tool's id
when the request carries a `wtk_` grant token, an allowlisted `X-Client-Id` header
otherwise (the add-in stamps its own), and null for unlabelled first-party traffic.
That gives research provenance ("which tool generated this completion") for free —
it's a column on both `llm_usage` and the JSONL log envelope. Per-user/per-tool
quotas remain deferred to Phase 3.

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

### v2: rooms (live, multi-surface, opt-in per join)

The first draft of this section was a point-to-point relay (taskpane ↔ one
tool, keyed by grant). Generalizing it to **rooms** costs little and buys
the multi-device cases (phone/voice surfaces, several documents open,
eventually collaborators):

- **A room is anchored on a document-in-progress.** The taskpane (or
  standalone editor) that holds the document creates the room and joins as
  the **doc authority** — the one member that can execute Office.js, so
  all `EditorAPI` RPCs route to it. A user with three documents open has
  three rooms.
- **Everything else is just a member.** Browser-tab tools, a phone voice
  surface, an in-taskpane panel tool — all identical from the protocol's
  point of view: connect a WebSocket to `/api/rooms/:id/ws` with a Bearer
  token, receive membership + scopes, then exchange messages.
- **The server is a dumb switchboard.** It enforces membership and scopes
  and forwards messages; it holds no document state (the handoff snapshot
  stash aside). No OT/CRDT, no server-side document model — the document
  in Word stays the single source of truth, which keeps the backend thin
  and the mental model simple. If real multi-writer editing ever matters,
  that's a different project.
- **Message vocabulary**, versioned as part of the platform contract:
  - `rpc` — `EditorAPI`-shaped calls (`getDocContext`, `selectPhrase`,
    `proposeEdit`, …) addressed to the doc authority, gated by `doc:read`
    / `doc:write` scopes.
  - `broadcast` — tool-defined messages fanned out to other members (how
    the phone half of a prototype talks to its desktop half without us
    having to anticipate their protocol).
  - `presence` — join/leave/authority-offline events, so a phone can show
    "connected to *Draft of paper.docx*" and tools can react cleanly when
    the taskpane closes.
- Write access defaults to **patch-with-confirm**: the tool proposes an
  edit, the sidebar shows it, the writer applies it. Direct silent writes
  only for trusted first-party tools.
- **Lifecycle**: the room record is a cheap persistent row (id, owner, doc
  label, per-member scopes); *connections* are ephemeral. "Active" just
  means it has connected members. If the doc authority is offline, `rpc`
  calls fail fast with `authority_offline` — v1 does not queue.

**Joining: explicit control that can still "just work".**

- The launch grant from Phase 1 *is* a room invitation — same primitive,
  now carrying a room id and scopes. Nothing new to invent.
- From the sidebar: "Open on another device" shows a QR code / short URL
  wrapping a grant (the device-flow `user_code` UX, reused). Scan with the
  phone → signed in (or device flow if not) → joined to *that* room.
- From a device directly: `GET /api/rooms` lists the user's rooms with
  human labels (doc title, host app, last-active). Exactly one active room
  → auto-join it (the "just work" path). Several → a picker. This is the
  whole "which device gets which document" UI: you always joined a
  specific room, and the room list + per-room member list ("this phone,
  this mindmap tab") is the audit and revocation surface.
- **Multiple users later** slot in as invitations to another account:
  membership records already carry (user, device, scopes), so a
  collaborator's device is just a member whose user ≠ owner. Presence
  makes them visible; the owner revokes membership the same way as for
  their own devices. Nothing about the v1 protocol needs to change — only
  the invitation UI and log-attribution rules.

## Taskpane-shaped tools (panel surface)

Some prototypes genuinely fit the sidebar. For those, the browser-launch
story is wrong — they belong inside the taskpane. Two decisions:

**Trust: first-party only, and not just for simplicity.** Rendering
third-party code inside the taskpane reopens everything browser-launch
avoided (sandbox origin, Office-webview quirks), *and* adds an AppSource
concern: the add-in was validated as our code on our domains, and loading
arbitrary external content inside it is the kind of post-approval behavior
change store policies frown on. Third-party tools stay browser-launched;
"panel" tools are ones we host and vet. Revisit only if a sandbox origin
ever lands.

**Integration: iframe + join the room — not a merge, and not a second
API.** A panel tool is built and deployed independently (own repo or
`sandbox/`, static assets under `/tools/<name>/` on our origin or a
subdomain) and rendered in an iframe on a generic "tool host" page in the
sidebar (chrome: title, back button, disconnect). Crucially, it talks to
the platform the same way every other surface does: bearer token + join
the room as a member. We could build a postMessage bridge to `EditorAPI`
instead — lower latency, works offline — but that would mean two
transports for one protocol and a second thing for tool authors to learn.
One rule keeps the platform small: **"join the room, speak the protocol";
where a tool renders (tab, phone, iframe) is orthogonal to how it
integrates.** The iframe host page can hand the grant to the frame via
`postMessage` so panel launches skip the device flow.

The practical payoff: a taskpane-shaped prototype stops requiring a
`PageName` case, a frontend-bundle merge, and a production deploy of the
add-in. It requires uploading static files and adding a manifest entry.

## Registration UX

Keep it far short of an app store:

- **Phase 1:** hardcoded first-party list (mindmap, …) on a new "Tools"
  page in the sidebar (`PageName.Tools` next to Chat/Draft/Revise), plus a
  "paste a URL" field for ad-hoc launches.
- **Later:** a tool manifest — small JSON (name, launch URL, requested
  scopes, contact) fetched from `<tool-origin>/.well-known/writing-tool.json`
  or pasted. Requested scopes drive a consent screen ("Mindmap wants:
  LLM access, read your document"). For community studies this consent
  screen is also where IRB-relevant disclosure lives. The manifest also
  carries a `surface` hint — `page` (browser launch, default; the only
  option for third parties) or `panel` (first-party, rendered in the
  taskpane tool host).
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
| Revocation | session revoke via sidebar | plus per-room member list ("this phone, this mindmap tab") with per-member revoke |

Also worth stating: permissive CORS is *compatible* with the bearer-token
model (no cookies to steal cross-site), but cookie-authenticated routes
(`/api/auth/*` browser flows) must keep relying on Better Auth's
`trustedOrigins` and never be callable with ambient credentials from tool
origins.

## Phasing

1. **Phase 0 (prereq) — done:** Bearer required on `/api/openai/*` and
   `/api/log`, failing closed for sessionless traffic; usage and logs attributed
   to the session user *and* to a `client_id` (add-in vs. tool). See the Status
   note above.
2. **Phase 1 — done:** "Tools" page in the sidebar; hardcoded tool list + URL
   field; browser launch with handoff grant (token + read-only doc snapshot);
   device-flow fallback for direct visits. (Porting the mindmap to actually
   consume the grant is tracked separately — it lives on `feat/uist`.)
3. **Phase 2:** rooms — WebSocket switchboard with membership + scopes
   (`doc:read` / `doc:write`, patch-with-confirm writes), `rpc` /
   `broadcast` / `presence` message types, room list + QR/short-URL join.
   The phone/voice use case is the acceptance test: a student prototype's
   phone half talks to its desktop half through `broadcast` without any
   platform changes.
4. **Phase 2.5:** taskpane tool host — iframe page in the sidebar that
   renders first-party panel tools, which join the room like any other
   member.
5. **Phase 3 (community service):** scoped tokens, quotas, manifest
   registration + consent screens, per-study log tenancy and export.
