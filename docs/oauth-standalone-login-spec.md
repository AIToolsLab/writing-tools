# Track A: scoped OAuth login for standalone Mindmap

The standalone Mindmap may call the two text-generation proxies as a signed-in
Writing Tools user. It receives no document or room access. The user transfers
text manually.

## Protocol contract

- Fixed public client id: `writing-tools-mindmap`.
- Authorization Code with PKCE S256; client authentication method `none`.
- Exact scope: `openai:chat`.
- Access token lifetime: 12 hours; no refresh token.
- Dynamic and unauthenticated registration are disabled.
- The fixed client skips consent. No general consent page is registered.
- The OAuth resource and JWT audience are the canonical backend origin from
  `new URL(BETTER_AUTH_URL).origin`, with no path or trailing slash.
- Production resource: `https://app.thoughtful-ai.com`.
- Development resource: `http://localhost:8000`.
- Mindmap sends that exact resource on both authorize and token requests.
- JWT issuer is `<canonical backend origin>/api/auth`.

Redirects are environment-specific. Development registers only
`http://localhost:5181/`. Production registers only
`https://mindmap.thoughtful-ai.com/`; the production authorization server must
not register localhost.

## Authorization boundary

An `openai:chat` OAuth token is accepted only at:

- `POST /api/openai/chat/completions`
- `POST /api/openai/responses`

OAuth verification belongs in proxy identity resolution, not the shared
`resolveUser` helper. The shared helper also protects logging, consent, activity
erasure, Realtime credential minting, and `POST /api/handoff`; accepting this
scope there would enable destructive access and credential laundering. A
presented invalid or expired OAuth credential returns a platform-auth 401 and
must never degrade to sessionless/demo access.

The resource server verifies signature, issuer, audience, expiry, and scope,
loads the subject through Better Auth's adapter, reapplies the existing beta
allowlist, and attributes usage using the signed `azp` client id. Verification
runs in-process (`auth.api.verifyJWT`, reading the jwt plugin's keys from the
database), not via the oauth-provider resource client, which would fetch
`/api/auth/jwks` over HTTP from the server's own public origin. No token
introspection is configured, so opaque access tokens are never accepted.

Revocation rides on the authorizing sign-in: the token's `sid` claim names the
Better Auth session that approved it, and the proxy requires that session to
still exist, be unexpired, and belong to `sub`. Signing out of Writing Tools (or
the session expiring) therefore revokes Mindmap's token immediately. Disabling
the client, by contrast, only stops new grants.

The `jwt()` plugin (which signs these access tokens) also lets any session
fetch a session JWT from `GET /api/auth/token`, signed with the same keys. The
proxy rejects those: their issuer is the bare origin rather than
`<origin>/api/auth`, and they carry no `openai:chat` scope or trusted `azp`.

## Provisioning and deployment

`MINDMAP_OAUTH_CLIENT_ID` and `MINDMAP_OAUTH_REDIRECT_URIS` configure the fixed
client. The server (not `migrate.ts`, whose k8s initContainer lacks this config)
creates or updates the client's managed fields through Better Auth's adapter at
startup. Updates preserve `disabled` (which stops new grants; issued JWTs stay
valid until expiry), and no client cache is used.

Both variables are optional and have no code defaults. If either is unset, the
server warns at startup, provisions nothing, and the proxy accepts no OAuth
tokens: Mindmap login is off, everything else runs normally. So this can merge
before the deployment is configured; enabling Mindmap in production means
adding the two env vars to the app container in the k8s chart. No stale
client purge migration is shipped: #594 never reached production, and deleting
unknown client ids would endanger future clients. Experimental local databases
may be removed manually.

## Verification

The integration test uses the real handler, adapter, PKCE exchange, signed JWT,
and JWKS verification. It covers both proxies, exact resource enforcement,
issuer/audience/scope/expiry, allowlist refusal, disabled-client preservation,
registration refusal, invalid PKCE and redirects, demo fall-through prevention,
and refusal at non-proxy routes including `/api/handoff`.
