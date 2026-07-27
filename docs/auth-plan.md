# Auth Plan

Plan for replacing Auth0 in the writing-tools add-in.

> **Status:** The production backend is now TypeScript/Hono after PR #448.
> Auth0 is still active in the frontend. Better Auth has been proven in an
> isolated Hono playground, but it is not yet integrated into production.
> The next implementation step is backend-first and must not change current
> Chat, Draft, or Revise behavior.

## Current State

The production application currently has two separate auth-related realities:

- The frontend uses Auth0 for login, logout, session caching, and access-token
  retrieval.
- The Hono backend does not validate those Auth0 tokens or require any other
  authentication.

Relevant files:

- `frontend/src/pages/app/index.tsx`
  - Mounts `Auth0Provider`.
  - Controls authenticated and unauthenticated UI state.
  - Provides Auth0's `getAccessTokenSilently` through the existing token
    context.
- `frontend/src/contexts/authTokenContext.tsx`
  - Defines the current token-provider interface.
  - Does not own or persist the Auth0 session.
- `frontend/src/api/wordEditorAPI.ts`
  - Implements the current Word-specific Auth0 login and logout flow.
- `frontend/src/api/googleDocsEditorAPI.ts`
  - Contains incomplete Google Docs authentication behavior.
- `frontend/src/api/openai.ts`
  - Configures the AI SDK client.
  - Does not currently attach an Auth0 or Better Auth token.
- `backend/src/app.ts`
  - Hosts the Hono API, OpenAI proxy, logging routes, and PostHog middleware.
  - Uses permissive CORS because backend authentication is not implemented.
  - Currently allows unauthenticated calls to
    `/api/openai/chat/completions`.

The isolated Hono + Better Auth playground established that:

- Better Auth can mount inside a Hono server at `/api/auth/*`.
- Google OAuth can complete and create a Better Auth session.
- `auth.api.getSession({ headers })` can validate cookie and Bearer sessions.
- A protected Hono route can return `401` without authentication.
- A Bearer-authenticated request can identify the signed-in user.
- An auth guard can run before an OpenAI-compatible streaming response.

The playground did not prove the complete device-authorization flow inside the
real Word or Google Docs surfaces.

## Goals

- Identify authenticated users for logging, analytics, and future per-user
  features.
- Support a backend-issued token that embedded clients can send as
  `Authorization: Bearer <token>`.
- Use one backend auth implementation for Word, Google Docs, and standalone
  surfaces where practical.
- Open Google sign-in in the user's normal browser instead of embedding Google
  OAuth inside a taskpane or iframe.
- Ensure the taskpane that begins login receives the token for that same device
  authorization request.
- Keep existing AI and study workflows working while auth is introduced.
- Preserve the ability to revoke sessions.
- Keep Auth0 operational until its replacement works end to end.

## Non-Goals For The First Integration

- Removing Auth0.
- Rewriting the production login UI.
- Protecting `/api/openai/chat/completions` before the frontend sends Better
  Auth tokens.
- Requiring authentication for logging or researcher routes before their
  intended policies are decided.
- Supporting multiple OAuth providers.
- Migrating existing Auth0 users.
- Implementing account deletion, export, study cohorts, or anonymous-use
  limits in the first backend PR.
- Solving Word desktop and Google Docs integration before the standalone and
  Word web flows are proven.

## Proposed Direction

| Question | Current direction | Notes |
|---|---|---|
| Backend | Existing TypeScript/Hono backend | PR #448 is merged; no new backend service is needed |
| Auth library | Better Auth | Avoids maintaining custom OAuth and session implementations |
| Initial provider | Google OAuth | Microsoft and other providers remain future work |
| Embedded login | Better Auth Device Authorization plugin | Implements OAuth 2.0 Device Authorization Grant behavior |
| API authentication | Better Auth Bearer plugin | Allows taskpanes and scripts to use `Authorization: Bearer` |
| Initial persistence | SQLite | Deployment persistence and native addon support must be verified |
| Migration order | Backend first, frontend second | Keep production behavior unchanged during backend setup |
| AI route enforcement | Last | Only after every supported frontend can attach a valid token |

This direction uses Better Auth's documented Device Authorization plugin rather
than building custom `pending_logins` and polling tables from scratch.

References:

- <https://better-auth.com/docs/integrations/hono>
- <https://better-auth.com/docs/plugins/device-authorization>
- <https://better-auth.com/docs/plugins/bearer>

## Device Authorization Model

The Better Auth Device Authorization plugin returns separate values with
different security roles:

- `device_code`
  - Private credential retained by the taskpane.
  - Used when polling for the resulting access token.
  - Must not be placed in the browser URL or exposed to the user.
- `user_code`
  - Short code intended for browser verification and user confirmation.
- `verification_uri`
  - Generic browser page where a user can enter a code.
- `verification_uri_complete`
  - Browser URL with the safe `user_code` already included.
- `interval`
  - Minimum polling interval the taskpane must respect.

Intended flow:

```text
Taskpane                    Hono + Better Auth              Browser / Google
    |                               |                               |
    | request device authorization |                               |
    |------------------------------>|                               |
    | device_code, user_code,       |                               |
    | verification_uri_complete     |                               |
    |<------------------------------|                               |
    |                               |                               |
    | open verification_uri_complete ------------------------------>|
    | retain private device_code    |                    Google login|
    |                               |<------------------------------>|
    |                               | authenticated browser session |
    |                               |<-------------------------------|
    |                               | verify and approve user_code   |
    |                               |<-------------------------------|
    |                               |                               |
    | poll using private device_code|                               |
    |------------------------------>|                               |
    | authorization_pending         |                               |
    |<------------------------------|                               |
    |                               |                               |
    | poll again at allowed interval|                               |
    |------------------------------>|                               |
    | access token                  |                               |
    |<------------------------------|                               |
    |                               |                               |
    | Authorization: Bearer token   |                               |
    |------------------------------>|                               |
    | protected response            |                               |
    |<------------------------------|                               |
```

The plugin's `deviceCode` table owns the mapping between the pending device
request, its approval state, and the authenticated user. A separate custom
`device_code -> session_token` table should only be introduced if the official
plugin cannot satisfy the application flow.

Completing Google login does not automatically imply device approval. The
browser session must verify and approve the `user_code`, unless the team makes
an explicit and carefully reviewed decision to auto-approve.

## Backend Phase 1: Better Auth Foundation

Create a feature branch from current `main`.

Add Better Auth to the existing `backend/` service:

1. Add and pin Better Auth and the selected SQLite adapter dependencies.
2. Add `backend/src/auth.ts` with:
   - SQLite database connection.
   - Google social provider.
   - Better Auth secret and base URL.
   - Bearer plugin.
3. Mount Better Auth before the existing API routes:

   ```ts
   app.on(["POST", "GET"], "/api/auth/*", (c) =>
     auth.handler(c.req.raw),
   );
   ```

4. Add a temporary or explicitly diagnostic `GET /api/protected` route:

   ```ts
   const session = await auth.api.getSession({
     headers: c.req.raw.headers,
   });
   ```

5. Add tests proving:
   - No auth returns `401`.
   - A valid browser session is accepted.
   - A valid Bearer session is accepted.
   - The response identifies the expected user.
6. Keep all existing production routes, including the OpenAI proxy,
   behaviorally unchanged.

Phase 1 is successful when Better Auth and the current backend can run together
without changing frontend behavior.

## Backend Phase 2: Device Authorization

After the foundation works:

1. Add Better Auth's Device Authorization plugin.
2. Configure a verification page URI owned by the Hono backend.
3. Validate known device-flow client IDs, beginning with a dedicated
   writing-tools test client.
4. Run the Better Auth migration that adds the required `deviceCode` table.
5. Add a minimal browser verification and approval page.
6. Add a standalone test client that:
   - requests device authorization,
   - opens `verification_uri_complete`,
   - retains the private `device_code`,
   - polls at the returned interval,
   - receives an access token,
   - calls `/api/protected` with that token.
7. Test the required error cases:
   - `authorization_pending`,
   - `slow_down`,
   - `access_denied`,
   - `expired_token`,
   - invalid device code,
   - invalid client ID.

Phase 2 is successful when the backend can securely deliver a token to the
same client that initiated the device request without custom Better Auth
internals.

## Frontend Phase 1: Word Web

After the backend device flow passes independently:

1. Add a frontend session interface without removing the existing Auth0
   implementation.
2. Let the Word web taskpane request a device authorization.
3. Retain the private `device_code` in taskpane memory while login is pending.
4. Open `verification_uri_complete` in the user's normal browser.
5. Poll according to the server-provided interval and error responses.
6. Store the returned token temporarily for the first integration.
7. Use the token to call `/api/protected`.
8. Verify sign-out and expired-session behavior.

Longer-term storage may use `localStorage`, but that decision requires a
security review for each surface. The first integration should avoid assuming
that every embedded environment has identical storage isolation.

## Frontend Phase 2: Protected AI Requests

Only after the taskpane can reliably obtain and use a Better Auth token:

1. Add a token-aware AI SDK client or custom `fetch` boundary in
   `frontend/src/api/openai.ts`.
2. Attach `Authorization: Bearer <token>` to AI SDK requests.
3. Confirm streaming still works with the authorization header.
4. Add the Better Auth session guard to
   `/api/openai/chat/completions`.
5. Update backend tests to cover:
   - `401` without authentication,
   - successful authenticated proxy requests,
   - upstream OpenAI errors,
   - streaming responses.
6. Decide whether anonymous AI requests remain supported and where any usage
   limit is enforced.

The OpenAI route must not be protected before this frontend phase is ready,
because current Chat, Draft, and Revise requests do not send Better Auth
credentials.

## Additional Surface Phases

### Word Desktop

- Test whether an ordinary external link reliably opens the default browser.
- Confirm the browser can return to the verification/approval page without
  relying on Office dialog cookies.
- Keep the device flow independent of taskpane browser-cookie behavior.
- Retain Auth0 until the replacement flow is proven in supported desktop
  environments.

### Google Docs

- Treat the sidebar as a frontend client of the Hono backend.
- Test external-browser opening, polling, and local token storage directly.
- Avoid assuming that the older Apps Script proxy remains part of the final AI
  request path.
- Confirm Google Docs origin, iframe, and storage behavior before declaring the
  Word implementation reusable without changes.

### Standalone

- A normal cookie-based Better Auth flow may be simpler than device
  authorization.
- The team should decide whether consistency across surfaces is worth using the
  device flow where it is not technically required.

## Database And Deployment

Better Auth should own its standard auth schema rather than duplicating it in
hand-written SQL. Expected core data includes users, accounts, sessions,
verification data, and device authorization records.

Application-specific study metadata may require a separate table or supported
Better Auth user fields, for example:

```text
user_id
is_study_user
study_cohort
```

Before production deployment:

- Decide whether SQLite is sufficient for the expected concurrency and hosting
  model.
- Persist the database outside the container filesystem.
- Verify the chosen SQLite Node package builds in the backend's Node slim
  Docker image.
- Back up and migrate the database explicitly.
- Keep auth secrets out of source control.
- Confirm session expiration, revocation, and cleanup behavior.

## CORS, Cookies, And Origins

The current backend uses permissive CORS because it has no backend auth.
Better Auth integration requires an explicit origin and cookie strategy.

Questions to resolve:

- Whether production requests are same-origin through nginx.
- The exact local Word origin, currently HTTPS on localhost.
- The deployed Word add-in origin.
- Google Docs sidebar and iframe origins.
- Whether browser verification pages and auth APIs share a domain.
- Which routes need cookie credentials versus Bearer authentication.
- Which origins belong in Better Auth's trusted origin configuration.

Hono CORS middleware must run before Better Auth routes when cross-origin
cookie requests are supported. Do not copy the playground's localhost CORS
configuration directly into production.

## Route Protection Policy

Authentication should be added route by route rather than globally.

Initial policy:

| Route | Initial auth policy |
|---|---|
| `/api/auth/*` | Managed by Better Auth |
| `/api/protected` | Always authenticated; diagnostic during integration |
| `/api/openai/chat/completions` | Remains open until frontend token support is ready |
| `/api/log` | Separate study/privacy decision |
| `/api/logs_poll` | Continue using `LOG_SECRET` initially |
| `/api/download_logs` | Continue using `LOG_SECRET` initially |
| `/api/ping` | Public |

This prevents an incomplete auth migration from breaking the production add-in
or researcher tooling.

## Migration From Auth0

Auth0 removal is a final migration step, not part of the backend foundation.

Before removal:

- Better Auth works on every supported surface.
- Login, logout, session restoration, and expiry are tested.
- Protected AI requests work reliably.
- Demo and anonymous behavior is explicitly decided.
- Current allowed-user and onboarding behavior has a replacement.
- Existing Auth0 test users have been informed that they must sign in again.
- Privacy documentation is updated.

Only then should the team remove:

- `@auth0/auth0-react`,
- `Auth0Provider`,
- `useAuth0` call sites,
- Auth0 environment variables,
- Auth0-specific Word popup/callback code that is no longer needed.

## Deferred Work

- Microsoft OAuth and other providers.
- Account linking.
- Account deletion and data export.
- Self-service study enrollment.
- Study cohort administration.
- Anonymous-use limits.
- Active-device management.
- Per-session revocation UI.
- Server-side anonymous rate limiting.
- Migration of existing Auth0 users.

## Open Questions

- Is explicit device approval required, or is auto-approval acceptable after a
  user deliberately opens `verification_uri_complete` and signs in?
- Should standalone users use the device flow or a normal cookie session?
- Is Google OAuth sufficient for early Word users?
- How long should Better Auth sessions live?
- Where should taskpane tokens be stored on each surface?
- Which routes must require login during research studies?
- Should logging accept anonymous events?
- Is SQLite sufficient for production, or only for the initial deployment?
- What are the production backend and verification-page domains?
- Does the Word desktop default-browser link work reliably across supported
  Office versions and operating systems?
- Does the Google Docs sidebar support the same polling and token-storage model
  without special handling?

## Implementation Order

1. Better Auth foundation in the existing Hono backend.
2. Diagnostic protected route and backend tests.
3. Official Device Authorization plugin and migrations.
4. Browser verification/approval page.
5. Standalone device-flow test client.
6. Word web taskpane integration.
7. Word desktop and Google Docs surface validation.
8. Token-aware AI SDK requests.
9. Protect the OpenAI proxy and update tests.
10. Decide anonymous/study policies.
11. Remove Auth0 only after full replacement validation.
