# Spec — trusted Mindmap client, no-screen launch, end-to-end test

Target branch: `agent/oauth-rooms-pkce-poc` (PR #594, draft).
Base: commit `d3053b8c`, all 11 CI checks green.
Companion doc: `docs/oauth-rooms-pkce-poc.md` (update it as part of this work).

Implementation status (2026-07-31): implemented and validated locally. Task 0
confirmed that Better Auth 1.6.22 calls `consentReferenceId` before its
`skipConsent` branch. The only remaining deployment input is the final production
Mindmap hostname/exact redirect URI. Review hardening added an OAuth error redirect
for wrong-account launches, one-time v7 stale-client cleanup, adapter-backed
provisioning, live database reads instead of the permanent trusted-client cache,
and explicit issuer validation. Nothing from this pass has been pushed.

This spec covers three changes that are **one logical change**: making Mindmap a
pre-registered trusted OAuth client, deleting the room-confirmation machinery
that a trusted client makes unnecessary, and pinning the resulting no-screen
flow with a real end-to-end test.

---

## Why

Two review rounds established:

1. **Open dynamic client registration is the one genuine merge blocker.**
   `allowDynamicClientRegistration` and `allowUnauthenticatedClientRegistration`
   are both `true` in `backend/src/auth.ts`. Anyone can register a client
   against a production authorization server.

2. **Both per-launch screens are our design, not PKCE's**, and they have
   *different* causes — fixing one does not fix the other:

   | Screen | Gated by | Cause |
   |---|---|---|
   | `/api/oauth/room` | `postLogin.shouldRedirect` → selection keyed by `(session, state)` | fresh `state` every launch ⇒ never a match |
   | `/api/oauth/consent` | Better Auth remembered consent | keyed on `clientId + userId + referenceId`; `referenceId` is the room, new every launch ⇒ never a match |

   Verified in `@better-auth/oauth-provider@1.6.22`: the consent lookup at
   `dist/index.mjs` (~line 58) is
   `where: [clientId, userId, ...(referenceId ? [referenceId] : [])]`, and
   `skipConsent` exists as a client field (`dist/oauth-D74mBkw6.d.mts:1237`,
   schema at `:25`).

A trusted client with `skipConsent` fixes the consent screen. Deleting the
confirm page fixes the other. Together they give: existing browser session →
brief redirect, no screens; no session → sign in, then straight back.

---

## The security boundary (state it this way)

Do **not** describe the room as coming from "the signed authorization request."
The room id originates in Mindmap-generated OAuth `state` and is not signed by
the taskpane — any party can put any value there. Better Auth integrity-protects
the *continuation* (`oauth_query`, the `sig=` parameter), not the provenance of
`state`.

What actually holds the flow together is four things in conjunction:

1. a fixed trusted client with an **exact** registered redirect URI,
2. an authenticated user,
3. **server-side verification that the room belongs to that user**,
4. a room-bound signed access token, re-checked at the resource.

Removing the confirmation page removes the last human checkpoint, so (3) plus
room-id unguessability (`room_` + 18 random bytes) carries the weight. That is
an acceptable trade — an attacker must already know the victim's room id *and*
drive the victim's browser — but record it as a decision in
`docs/oauth-rooms-pkce-poc.md`, not as a silent side effect of a UX cleanup.

---

## Task 0 — verify the load-bearing assumption FIRST

**Do not build on this until it is confirmed.** The entire design assumes the
room id still reaches the access token when consent is skipped.

Today the chain is:

```
postLogin.consentReferenceId  →  referenceId
   →  customAccessTokenClaims({ referenceId })  →  room_id claim
   →  customTokenResponseFields  →  room_id in the token response
```

`consentReferenceId` is a **consent-time** hook. If `skipConsent: true` bypasses
it, `referenceId` is never set, `room_id` never reaches the token, and
`finishRoomAuthorization` fails its own `roomId !== request.roomId` check.

**Determine, from the installed 1.6.22 source, whether `consentReferenceId`
still fires for a client with `skipConsent: true`.** Write a throwaway probe if
reading the source is ambiguous.

- **If it fires** — proceed as specified below.
- **If it does not** — stop and report. Do not invent a workaround; the
  alternative (deriving the room inside `customAccessTokenClaims` from the
  authorization query, with the ownership check moved there) changes where the
  security boundary sits and needs review before implementation.

Record the finding in the PR description either way.

---

## Task 1 — trusted fixed client

### Backend (`backend/src/auth.ts`)

- Set `allowDynamicClientRegistration: false` and
  `allowUnauthenticatedClientRegistration: false`.
- Seed one Mindmap client at startup (idempotent — safe to run on every boot):
  - client id from config, not hardcoded; expose as an env var alongside the
    existing Better Auth config in `backend/src/config.ts`
  - `token_endpoint_auth_method: "none"` (public client)
  - `grant_types: ["authorization_code"]`, `response_types: ["code"]`
  - scopes `openai:chat doc:read`
  - **exact** `redirect_uris` — no wildcards, no prefix matching
  - `skipConsent: true`
- **`skipConsent` must apply to this client only.** Never make it a global
  option, and never grant it to a dynamically registered client.

### Purge stale clients

Disabling registration prevents *new* registrations; it does **not** revoke
clients already stored. Codex's own smoke runs have created some. Add a
deliberate cleanup (a migration or a documented one-off) that removes
dynamically registered `oauthClient` rows, and say in the doc which rows are
expected to survive.

### Mindmap (`prototype-mindmap/src/platform-session.ts`)

- Delete the `clientId()` self-registration path entirely: the
  `POST /oauth2/register` call and the `OAUTH_CLIENT_STORAGE_KEY` localStorage
  cache (~lines 220–255).
- Read a build-time `VITE_OAUTH_CLIENT_ID` instead. Fail closed in production if
  it is missing, matching how `VITE_BACKEND_URL` is handled at ~line 21.
- A public OAuth client id in the compiled bundle is **fine** — it is an
  identifier, not a secret. Do not add a secret-handling path for it.

### Redirect URI

`callbackUri()` returns `window.location.origin + window.location.pathname`.
The registered value must match exactly. **The production hostname is not yet
decided** (`mindmap.thoughtful-ai.com` vs a `prototypes.*` umbrella), so:

- implement the code now,
- leave the concrete registered URI and `.env.production` value as the only
  outstanding item, clearly marked,
- or register both candidate URLs deliberately if that is preferred — but say so
  explicitly rather than leaving it ambiguous.

---

## Task 2 — remove the confirm/selection machinery

A trusted client that derives the room server-side has nothing to "select." All
of the following goes:

| Delete | File |
|---|---|
| `ROOM_HTML` and the `/api/oauth/room` route | `backend/src/routes/oauth-pages.ts` |
| `authorizeOAuthRoom` endpoint | `backend/src/oauth-room-authorization.ts` |
| `selectRoomForOAuth`, `selectedRoomForOAuth`, `consumeRoomSelection` | `backend/src/rooms.ts` |
| `oauth_room_selection` table + the v5 migration | `backend/src/db.ts` |
| `postLogin.shouldRedirect` | `backend/src/auth.ts` |
| the tests covering the above | `backend/src/__tests__/rooms.test.ts` |

**Keep:**

- `currentOAuthAuthorization()` / `parseOAuthAuthorizationQuery()` — still how
  the room id is derived.
- `oauthRoomContext` — still useful for the consent page shown to *untrusted*
  clients, which keep normal consent.
- The `oauth_query` body parameter on the remaining endpoints, **and its
  comment**. It looks unused; it is what makes the provider's `before`
  middleware fire and verify the signature. Do not "clean it up."
- Fresh OAuth `state` per launch. It prevents callback mixups and CSRF. It is
  not what was causing consent to re-prompt.

`consentReferenceId` keeps the ownership check — parse the room from the
authorization query, `getRoomForUser(roomId, user.id)`, return the id or throw.
That check is now load-bearing on its own; it must fail closed.

Removing the v5 migration means the schema version drops. Decide deliberately
whether to renumber (clean, but breaks any existing dev DB) or add a v6 that
drops the table (safer). Document the choice — `db.test.ts` asserts the version
number and will need updating either way.

Note: this deletes the concurrent-tab state-keying from an earlier review round.
That fix was correct for the design as it stood; it simply stops being needed
once the page it protected is gone. Do not preserve it out of sunk cost.

---

## Task 3 — full no-screen integration test

Current coverage has a real gap. `oauth-room-middleware.integration.test.ts`
pins the signed-query middleware well, and `oauth-room-resource.test.ts` covers
the resource boundary — but it **injects a mocked `verifyOAuthAccessToken`**.
Nothing exercises a genuine signed token end to end.

Add one integration test, in the style of the existing middleware test (real
`auth.handler`, real adapter, temp `DATA_DIR`), covering:

```
trusted pre-registered client
  → /oauth2/authorize with an existing session
  → skipConsent (assert NO redirect to a consent or room page)
  → server-side room ownership check
  → authorization code at the exact registered redirect URI
  → /oauth2/token with code + code_verifier
  → REAL signed access token (not mocked)
  → GET /api/rooms/:roomId with that token
  → an authenticated OpenAI-proxy request with that token
```

Assert along the way:

- the authorize response goes **straight to the redirect URI**, not to
  `/api/oauth/room` or `/api/oauth/consent`
- the issued token carries the expected `room_id` claim
- `GET /api/rooms/<other-room>` with that token returns **403**
- a room owned by a *different* user fails the ownership check rather than
  issuing a token

Also add the negative case: an untrusted (dynamically registered, if any can
still exist) or unregistered client is refused.

---

## Also in scope

Stale comments in `frontend/src/pages/tools/index.tsx` still describe the device
allowlist as a requirement for first-party tools:

- `:10` — "such a tool signs in for itself via the device flow"
- `:30` — "must also be listed in the backend device allowlist"
- `:43` — `BETTER_AUTH_DEVICE_CLIENT_IDS`

Under this flow Mindmap's launch never reaches `deviceClientIds()` — that gate
is at `backend/src/app.ts:500`, on grant creation, and `POST /api/rooms`
(`app.ts:296`) authenticates with the taskpane session alone. Correct the
comments to say the device allowlist applies to **grant-based tools**, and note
that the tool/device-client split is still owed for those.

---

## Out of scope

Do not start these; they belong to a later polish PR:

- room lifecycle (every launch creates a new room; no TTL, no dedup)
- a user-facing room list or delete endpoint
- refresh tokens / the 1-hour expiry UX
- the raw-SQL user lookup in `resolveUser`'s OAuth branch
- CSS extraction / inline-`<script>` CSP hardening in the OAuth pages
- `#593`'s Pages smoke-test rewrite (separate PR, separate branch)

---

## Verification

- `npm test` in `backend/`, `frontend/`, `prototype-mindmap/` — all green
- all three builds pass
- lint/format and `git diff --check` pass
- the new integration test fails if `skipConsent` is removed from the trusted
  client (i.e. it is actually asserting the no-screen property)
- `docs/oauth-rooms-pkce-poc.md` updated: no room picker *or* confirm page, the
  four-part security boundary stated as above, the removed-checkpoint decision
  recorded, and the Task 0 finding written down

Report what was verified versus assumed. If Task 0 comes back negative, stop
after reporting it.

---

## Reminders

- Commit, do not push — pushes are confirmed separately.
- Work stays on `agent/oauth-rooms-pkce-poc`; do not touch other worktrees.
- The production hostname is undecided and gates only the final registered
  redirect URI and `.env.production`. Everything else here can be completed now.
