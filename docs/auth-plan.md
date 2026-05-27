# Auth Plan

Replacement for Auth0 in the writing-tools add-in. Scope was narrowed via conversation in PR #433.

> **Status:** under evaluation alongside `docs/js-backend-plan.md`. That plan proposes rewriting the backend in TypeScript and adopting Better-Auth instead of rolling auth in FastAPI. A Stage 0 POC there will decide which plan we commit to.

## Goals

- **Identify users** for logging, analytics, and per-user data (saved prompts, settings, history).
- **Tag study participants** distinctly from production users.
- **Allow limited anonymous use** so first-time visitors can try the tool before being asked to sign in.
- **Work uniformly across all three surfaces**: Word task pane, Google Docs sidebar, standalone editor.
- **Sign in once per device**, stay signed in for at least 30 days, silent refresh.

## Non-Goals (MVP)

- Multiple sign-in providers. Google OAuth only for v1. Microsoft, magic link, and email/password are deferred.
- Self-service study cohort assignment. Manual DB flag is acceptable for the MVP; UI/invite-code flows are future work.
- Migration of existing Auth0 users. Treat as a clean start; current test users re-sign-in.
- Account linking when the same person signs in with different providers. Deferred until a second provider exists.

## Decisions

| Question | Decision | Rationale |
|---|---|---|
| Flow shape | Device-code / login-link, opens browser tab | Avoids OAuth-in-iframe pain across Word and GDocs with a single implementation |
| Identity model | Single shared identity, merged by verified email | Same person on Word and GDocs is the same user |
| Provider (MVP) | Google OAuth | Covers GDocs users natively, works fine for Word users with a Gmail account |
| Database | SQLite, on the existing persistent volume | Already have a volume for study logs; SQLite is zero-ops and upgradable later |
| Session token storage | `localStorage` on each surface | Simplest; per-iframe-origin scoping is fine |
| Session lifetime | 30 days, silent refresh | Matches VS Code / Claude Code expectations |
| Token format | Opaque session ID, validated against DB | We have a DB; enables instant revoke without JWT rotation complexity |
| Anonymous use | Allowed up to a per-device limit, tracked client-side in `localStorage` | No anon user records, no DB write per anon request |
| Account deletion / data export | In MVP | Good for IRB approval and future-proofs us against GDPR-style requests |

## Architecture Overview

```
┌────────────────────┐     1. open login URL    ┌──────────────────┐
│  Sidebar (Word /   │ ───────────────────────▶ │ Browser tab on   │
│  GDocs / standalone│                          │ backend domain   │
│  )                 │                          └────────┬─────────┘
│                    │                                   │ 2. Google OAuth
│  - device_code     │                                   ▼
│  - poll session    │                          ┌──────────────────┐
└────────┬───────────┘                          │ Google           │
         │                                      └────────┬─────────┘
         │ 3. GET /auth/poll?code=…                      │ callback
         │                                               ▼
         │                                      ┌──────────────────┐
         └─────────────────────────────────────▶│  FastAPI backend │
                                                │  + SQLite        │
                                                └──────────────────┘
```

The sidebar never embeds Google's consent screen. All OAuth happens in a normal browser tab on our own domain. The sidebar only ever talks to our backend.

## Data Model (SQLite)

```sql
-- A person. Created on first successful sign-in.
CREATE TABLE users (
  id              TEXT PRIMARY KEY,         -- ULID/UUID
  email           TEXT NOT NULL UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  display_name    TEXT,
  created_at      INTEGER NOT NULL,         -- unix seconds
  is_study_user   INTEGER NOT NULL DEFAULT 0,
  study_cohort    TEXT,                     -- nullable; arbitrary string
  deleted_at      INTEGER                   -- soft delete; null = active
);

-- One row per OAuth identity linked to a user. Future-proofs for multiple providers.
CREATE TABLE oauth_identities (
  provider         TEXT NOT NULL,           -- 'google'
  provider_user_id TEXT NOT NULL,           -- 'sub' claim
  user_id          TEXT NOT NULL REFERENCES users(id),
  linked_at        INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_user_id)
);

-- One row per signed-in device. Opaque session_id is what the client stores.
CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,         -- random 32+ bytes, base64url
  user_id         TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  last_used_at    INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,         -- created_at + 30d, slid forward on use
  user_agent      TEXT,                     -- for the user's "active devices" list
  revoked_at      INTEGER
);

-- Short-lived rows used during the device-code handshake.
CREATE TABLE pending_logins (
  device_code     TEXT PRIMARY KEY,         -- random; what the sidebar polls with
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,         -- ~10 minutes
  session_id      TEXT REFERENCES sessions(id)  -- null until OAuth completes
);
```

`oauth_identities` is overkill for a one-provider MVP but keeps the migration to two providers trivial.

## Flows

### First-time sign-in (device-code)

1. User clicks **Sign in** in the sidebar.
2. Sidebar calls `POST /auth/device/start`. Backend creates a `pending_logins` row with a fresh `device_code` and returns `{ device_code, login_url }`.
3. Sidebar:
   - Calls `window.open(login_url, '_blank')` (works in standalone, GDocs, and Word's task pane; falls back to a clickable "open in browser" link if blocked).
   - Begins polling `GET /auth/device/poll?device_code=…` every ~2 seconds.
4. The browser tab hits `GET /auth/login?device_code=…`. Backend redirects to Google's OAuth consent with `state=device_code`.
5. Google redirects back to `GET /auth/callback?code=…&state=…`. Backend:
   - Exchanges the code for tokens.
   - Looks up `oauth_identities` by `(google, sub)`. If missing, finds-or-creates a `users` row by verified email and inserts an `oauth_identities` row.
   - Creates a `sessions` row.
   - Sets `pending_logins.session_id`.
   - Renders a "You can close this tab" page.
6. The next sidebar poll sees `session_id` populated, gets `{ session_id, expires_at, user: { id, email, display_name } }`, stores it in `localStorage`, and stops polling.

### Authenticated request

- Sidebar adds `Authorization: Bearer <session_id>` to every `/api/*` request.
- Backend middleware looks up the session, checks `expires_at` and `revoked_at`, slides `last_used_at` forward, and attaches the user to the request context.

### Silent refresh

- On every authenticated request, the backend extends `expires_at` to `now + 30 days`. No separate refresh token. (This is the "rolling session" pattern; simpler than refresh-token rotation and fine for this risk level.)
- If the client sees a `401` from any `/api/*` call, it clears its local session and reverts to the anonymous-limit state.

### Sign-out

- `POST /auth/logout` with the bearer token sets `revoked_at` on the session row.
- Client clears `localStorage`.

### Anonymous use + limit

- All `/api/*` endpoints accept requests without a bearer token.
- Client tracks `anon_usage_count` in `localStorage`. On reaching the limit (proposal: **5 LLM-backed requests per device**, tunable), the UI swaps the action buttons for a sign-in prompt.
- The backend does **not** enforce the limit — we explicitly trust the client for anon throttling, since the cost of a determined evader clearing `localStorage` is low and we avoid maintaining anon records.
- When a user signs in, anon counters are not migrated; they're simply ignored from that point on.

### Account deletion

- `DELETE /auth/account` with bearer token. Backend:
  - Sets `users.deleted_at = now`.
  - Revokes all sessions.
  - Erases `email`, `display_name`, and `oauth_identities` rows for the user (so they can re-sign-up cleanly).
  - Leaves the `users.id` in place so foreign keys in logs/saved data don't dangle. Future work: a background job that scrubs PII from log rows older than the deletion timestamp.

### Data export

- `GET /auth/account/export` returns a JSON blob with:
  - The user row (minus `id`)
  - All saved per-user data
  - All log rows tagged with this user
- Streamed as a download. No third-party service involvement.

## API Surface (new endpoints)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/device/start` | Begin device-code flow; returns `{ device_code, login_url }` |
| `GET`  | `/auth/device/poll`  | Sidebar polls; returns session once OAuth completes |
| `GET`  | `/auth/login`        | Browser-tab entry point; redirects to Google |
| `GET`  | `/auth/callback`     | Google OAuth callback; completes the handshake |
| `GET`  | `/auth/me`           | Current user info (for the sidebar to display) |
| `POST` | `/auth/logout`       | Revoke current session |
| `DELETE` | `/auth/account`    | Soft-delete account + scrub PII |
| `GET`  | `/auth/account/export` | Export the user's data as JSON |

All under the same FastAPI app, same domain as `/api/*`. No new infra.

## Frontend Integration

- Replace `@auth0/auth0-react` and the `useAccessToken` context with a small Jotai atom (`sessionAtom`) plus a `useSession()` hook that:
  - Hydrates from `localStorage` on mount.
  - Exposes `{ user, signIn(), signOut(), isAuthed }`.
- `signIn()` runs the device-code flow described above.
- The AI SDK `openai` client in `frontend/src/api/openai.ts` gets a custom `fetch` wrapper that injects `Authorization: Bearer <session_id>` when a session exists.
- A small `<SignInGate>` component watches `anon_usage_count` and the session, and switches between "use the tool" and "sign in to continue" UI.

## Provider Setup

- **Google Cloud Console**: register a single OAuth 2.0 Web client.
  - Authorized JavaScript origins: production + staging domains.
  - Authorized redirect URIs: `https://<backend-domain>/auth/callback` for each environment.
- Scopes: `openid email profile` only. No Drive/Gmail scopes — we never call Google APIs on the user's behalf.

## Migration from Auth0

- Remove `@auth0/auth0-react` and the `useAccessToken` / `useAuth0` call sites.
- Delete `Auth0Provider` wrappers in `frontend/src/pages/app/index.tsx` and the editor entry points.
- Backend: the JWT validation middleware (if any beyond what we already saw) is removed in favor of the session-lookup middleware.
- Existing Auth0 test users are not migrated. Document this in the release notes for the rollout.

## Phases

**Phase 1 — Backend skeleton**
- SQLite schema + SQLAlchemy models
- `/auth/device/*`, `/auth/login`, `/auth/callback`, `/auth/me`, `/auth/logout`
- Session middleware
- Google OAuth via Authlib

**Phase 2 — Frontend integration**
- `useSession()` hook + Jotai atom
- Sign-in / sign-out UI in the sidebar
- AI SDK `fetch` wrapper injecting the bearer token
- `<SignInGate>` for the anon limit

**Phase 3 — Account management**
- `/auth/account` deletion
- `/auth/account/export`
- Tiny "Account" panel in the sidebar showing email + sign-out + delete

**Phase 4 — Study tooling**
- Admin CLI (or SQL snippets) to flip `is_study_user` and set `study_cohort`
- Logging integration: every log row carries `user_id` when available

## Future Work / Deferred

- **Additional providers** — Microsoft OAuth (probable next), magic link (for users without Google accounts).
- **Account linking UX** — when the second provider lands, let users link both to one account.
- **Self-service study enrollment** options to evaluate later:
  - Invite code at signup
  - Pre-seeded email allowlist
  - Admin flag after signup *(MVP)*
  - Separate `/study/signin` route encoding the cohort
- **Refresh-token rotation** instead of rolling sessions, if we ever care about stolen-token blast radius.
- **Background PII scrub** for logs after account deletion.
- **Active devices view** — list of sessions per user with per-session revoke.
- **Server-side anon rate limiting** if client-side trust proves abusable.

## Open Questions

- The exact anon-usage limit (5? 10? per session or per day?) — tune during QA.
- Backend domain in production needs to be settled before the Google OAuth client can be configured.
- Whether the standalone editor should *also* show a sign-in prompt or stay demo-mode-forever. Current plan: same `<SignInGate>` everywhere; demo mode is just "haven't hit the anon limit yet."
