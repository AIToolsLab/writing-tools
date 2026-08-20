# Rooms + OAuth Authorization Code/PKCE proof of concept

This branch replaces the launcher grant for Mindmap with a provider-native OAuth
flow. It deliberately leaves the existing `/api/handoff` implementation in place
for comparison and for other tools.

## Mental model

There are three different objects:

1. **Room** — durable server-side resource containing a document snapshot. The
   add-in creates it while authenticated as the writer.
2. **Authorization code** — short-lived, single-use result of the writer approving
   Mindmap. It is useless without the PKCE verifier that Mindmap generated and kept
   in its own session storage.
3. **Access token** — one-hour credential issued after the code + verifier exchange.
   Its signed `room_id` claim limits it to one room; scopes independently limit the
   operations (`doc:read`, `openai:chat`).

The room id is not a secret. It may appear in the launch URL and OAuth request.
Possession of it grants nothing.

## End-to-end sequence

1. The taskpane reads the current `DocContext` and sends it to `POST /api/rooms`
   with its existing Better Auth session bearer.
2. The taskpane opens `https://mindmap…/?room=room_…`.
3. Mindmap uses its pre-registered trusted public client id, creates a random PKCE
   verifier, stores the verifier in session storage, and sends
   only its SHA-256 challenge to `/api/auth/oauth2/authorize`. The non-secret room
   id is included in the standard `state` value to bind this authorization request
   to the exact launched room; the complete state also contains random bytes and
   is matched exactly at callback.
4. The authorization server authenticates the writer in the system browser. This
   may require Google sign-in because the Office taskpane and system browser do not
   necessarily share cookies.
5. `consentReferenceId` derives the room from Mindmap's OAuth state and verifies
   server-side that the signed-in user owns it. The room id is not signed
   provenance; the boundary is the exact-redirect client, authenticated user,
   ownership check, and room-bound signed token together. A missing room or a
   different signed-in account returns `error=access_denied` to the already
   validated Mindmap callback, where the app can explain the mismatch.
6. The trusted client has `skipConsent`, so an existing browser session returns
   directly to Mindmap without a room-confirmation or consent screen. A user with
   no browser session signs in first and then returns directly.
7. Mindmap receives the code at its registered redirect URI and exchanges it with
   the locally retained verifier. The verifier never travels in the launcher URL.
8. Mindmap calls `GET /api/rooms/:roomId`. The resource server verifies the token's
   signature, issuer, audience, `doc:read` scope, subject, and exact `room_id`.

## Relationship to #579 and #593

- This does not need `wt_api`, and the backend URL comes from Mindmap's deploy-time
  `VITE_BACKEND_URL`. That removes the attacker-selected proxy problem identified
  on #579 for this flow.
- Origin checks may remain defense-in-depth for the old handoff flow; they are not
  treated as client authentication here.
- #593's Pages deployment is still useful and should supply the production backend
  URL. Its skipped `wt_api` smoke assertion should be replaced for this branch with
  an OAuth configuration/launch smoke test.
- The clean implementation branch is based on current `origin/main`, not the dirty
  or ahead Mindmap worktrees. The useful #579/#593 changes should be rebased or
  cherry-picked after review rather than making this proof of concept depend on
  their current branch topology.

## Deliberate proof-of-concept limits

- A room currently has one owner and one document snapshot. There is no membership
  table, live synchronization, document update endpoint, or multi-document room.
- Dynamic and unauthenticated client registration are disabled. Startup
  idempotently provisions the configured Mindmap client through Better Auth's
  adapter. Migration v7 removes stale dynamic clients once; it preserves the
  configured Mindmap row and does not delete clients added after that migration.
- Tokens expire after one hour; refresh tokens are not enabled.
- Removing the confirmation checkpoint is deliberate: an attacker would need both
  an unguessable room id and the ability to drive its owner's browser. Fresh random
  OAuth state still prevents callback mixups and CSRF.
- Deleting logged activity preserves active rooms. Account deletion removes room
  snapshots.
- This is bearer-token security. PKCE prevents interception of the authorization
  code; it does not make a stolen access token unusable. Sender-constrained tokens
  (for example DPoP) would be a separate layer.

## Trusted-client implementation findings

In installed `@better-auth/oauth-provider` 1.6.22, `consentReferenceId` runs before
the `client.skipConsent` branch and its result is stored on the authorization-code
verification value. The resulting `referenceId` reaches both the custom access-token
claim and token response. The no-screen integration test exercises that behavior
with a real signed token, room-resource request, and OpenAI-proxy request.

Better Auth 1.6.22 calls `postLogin.shouldRedirect` whenever a `postLogin` object
exists. The configuration therefore retains a constant-false compatibility hook
and unreachable page value; there is no room-selection or confirmation machinery.

An appended v6 application migration drops `oauth_room_selection`, preserving
upgrades from existing v5 databases. Migration v7 performs the one-time stale-client
cleanup. The Mindmap client is deliberately not placed in Better Auth's process-wide
trusted-client cache, so changes such as `disabled = 1` are observed on the next
authorization request. Provisioning preserves that operational disable on later
starts. Environment-driven redirect changes still require a restart because startup
provisioning is what applies them.

The resource verifier explicitly validates the issuer as `BETTER_AUTH_URL` plus
Better Auth's `/api/auth` base path. Tokens are issued with that full value; using
the bare origin produces an otherwise opaque 401.

The final production hostname—and therefore the exact production redirect URI and
matching build-time values—remains the sole deployment configuration decision.
