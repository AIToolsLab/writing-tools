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
3. Mindmap registers as an OAuth public browser client (cached in local storage),
   creates a random PKCE verifier, stores the verifier in session storage, and sends
   only its SHA-256 challenge to `/api/auth/oauth2/authorize`. The non-secret room
   hint is included in the standard `state` value so the picker can highlight it;
   the complete state also contains random bytes and is matched exactly at callback.
4. The authorization server authenticates the writer in the system browser. This
   may require Google sign-in because the Office taskpane and system browser do not
   necessarily share cookies.
5. Better Auth's `postLogin` hook sends the writer to the room picker. The backend
   accepts a choice only when that signed-in user owns the room.
6. `consentReferenceId` returns the selected room id. The OAuth Provider plugin
   carries it through consent, authorization code, and access token.
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
- Public dynamic client registration is enabled to keep the branch runnable without
  an out-of-band client provisioning step. Production should provision the known
  Mindmap client (or tightly rate-limit/validate registration) and disable open
  registration.
- Tokens expire after one hour; refresh tokens are not enabled.
- The room picker's pending selection is session-scoped and expires after ten
  minutes.
- This is bearer-token security. PKCE prevents interception of the authorization
  code; it does not make a stolen access token unusable. Sender-constrained tokens
  (for example DPoP) would be a separate layer.
