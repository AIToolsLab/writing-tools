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
allowlist, and attributes usage using the signed `azp` client id.

## Provisioning and deployment

`MINDMAP_OAUTH_CLIENT_ID` and `MINDMAP_OAUTH_REDIRECT_URIS` configure the fixed
client. Better Auth's adapter creates or updates its managed fields after Better
Auth migrations. Updates preserve `disabled`, and no client cache is used.

Production fails closed when auth is enabled and either variable is missing.
The deployment environment must therefore be configured before merge. No stale
client purge migration is shipped: #594 never reached production, and deleting
unknown client ids would endanger future clients. Experimental local databases
may be removed manually.

## Verification

The integration test uses the real handler, adapter, PKCE exchange, signed JWT,
and JWKS verification. It covers both proxies, exact resource enforcement,
issuer/audience/scope/expiry, allowlist refusal, disabled-client preservation,
registration refusal, invalid PKCE and redirects, demo fall-through prevention,
and refusal at non-proxy routes including `/api/handoff`.
