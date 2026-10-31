# OAuth provider for first-party apps

The backend is an OAuth 2.1 authorization server (Better Auth's `oauthProvider`
plugin under `/api/auth/oauth2/*`), and its OpenAI proxy is the resource server
that accepts the resulting access tokens. This lets separately hosted
first-party apps call the proxy as a signed-in Thoughtful user.

The first and only client is the standalone Mindmap. It may call the two
text-generation proxies; it receives no document or room access, and the user
transfers text manually.

## Protocol contract

- Fixed public client id: `writing-tools-mindmap`.
- Authorization Code with PKCE S256; client authentication method `none`.
- Exact scope: `openai:chat`.
- Access token lifetime: 12 hours; no refresh token.
- Dynamic and unauthenticated registration are disabled.
- The fixed client skips consent. No general consent page is registered.
- Session-authenticated client and resource management are denied
  (`clientPrivileges` / `resourcePrivileges` return false).
- The OAuth resource and JWT audience are the canonical backend origin from
  `new URL(BETTER_AUTH_URL).origin`, with no path or trailing slash.
- Production resource: `https://app.thoughtful-ai.com`.
- Development resource: `http://localhost:8000`.
- Mindmap must send that exact resource at authorize (a Hono guard in `app.ts`
  refuses anything else, since an absent resource would yield an opaque token
  the proxy can't accept). The code is bound to it: the token request may omit
  `resource` or repeat the same value; any other value gets `invalid_target`.
- The resource is declared in the plugin's `resources` option, which seeds an
  `oauthResource` row. Per-client resource links (`enforcePerClientResources`,
  on by default in 1.7) are turned off: with one resource and only
  server-provisioned clients, a link would carry no information.
- JWT issuer is `<canonical backend origin>/api/auth`.

Redirects are environment-specific. Development registers only
`http://localhost:5181/`. Production registers only
`https://mindmap.thoughtful-ai.com/`; the production authorization server must
not register localhost.

## Login

When authorize finds no session, the provider redirects to `/api/oauth/login`
with a signed copy of the authorization query. That page names the requesting
client ("**Mindmap** wants to use Thoughtful's AI on your behalf"), looking up
`client_id` in the trusted-client list so only configured names can appear; an
unknown id gets a generic prompt. Since trusted clients skip consent, a user who
is already signed in never sees this page. It is one "Sign in with Google" button: it posts the signed query as `oauth_query` with the social
sign-in, the provider carries it through the Google OAuth state, and after the
callback sets the session it re-runs authorize and redirects to the client with
a code. A query edited after signing is refused (`invalid_signature`).

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
still exist, be unexpired, and belong to `sub`. Signing out of Thoughtful (or
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

The security guarantees are in
`backend/src/__tests__/oauth-security.e2e.test.ts`, written to be read as a
list of promises: each test is one assurance, told as what an attacker tries
and what the server does. It runs the real app over real HTTP, with anonymous
sign-in standing in for Google and a spy standing in for OpenAI. It covers:
codes only go to the registered redirect; a tampered login continuation is
refused; PKCE is required and a stolen code is useless without the verifier;
codes are single-use; nobody can register or edit clients; forged, altered,
expired, misdirected, wrong-client or session-less tokens are refused without
falling back to demo access; a valid cookie can't rescue a bad bearer; a
Mindmap token works only at the proxy; signing out revokes it; and users
outside the beta allowlist can sign in but can't spend.

Each guard was checked by removing it and watching its test fail
(`clientPrivileges`, the proxy's session-liveness, trusted-client and
allowlist checks).

`oauth-provider.integration.test.ts` covers the rest in-process: the login
page and its continuation, the 12-hour JWT at both proxies with usage
attribution, resource binding at authorize and token, and provisioning
(idempotent, preserves `disabled`, clears stale secrets, no localhost in
production, unset config disables Mindmap).
