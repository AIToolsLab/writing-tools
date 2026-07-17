# Database — future considerations

Running notes on where the current storage layer will strain, and what we'd do
about it. Not a plan of record; a place to capture "we'll cross that bridge
when we get to it" items so the reasoning isn't lost.

## Current state

- One SQLite file, `<DATA_DIR>/app.db`, on one shared connection, holding both
  Better Auth's tables and ours (see `backend/CLAUDE.md`, `backend/src/db.ts`).
- Our schema is versioned with `PRAGMA user_version` steps in `MIGRATIONS`;
  Better Auth introspects and manages its own.
- Structured study logs are **not** in SQLite — they're JSONL files under
  `backend/logs/<username>.jsonl`. LLM usage metering **is** in SQLite
  (`llm_usage`).

## Anonymous / demo users → row growth (from the anonymous-session work)

Adopting Better Auth's `anonymous` plugin means **every demo visitor becomes a
real `user` + `session` row**. This is fine at demo scale but grows unbounded
without a reaper. Options when it matters:

- Short session expiry for anonymous users + a periodic prune of expired
  anonymous accounts.
- A scheduled sweep deleting anonymous users older than N days that never
  linked to a real account.
- Note the cleanup gap: Better Auth's default post-link deletion removes the
  anon user row but does **not** run our `deleteUser.beforeDelete` hook, nor
  touch external state (JSONL logs, `llm_usage` rows, PostHog person) keyed to
  that anon id. A reaper needs to clean those too if we care about them.

## Growing beyond SQLite

SQLite is a good fit today (single container, single writer, modest volume).
Signals we'd be outgrowing it, and the likely response:

- **Concurrent writers / horizontal scaling.** The single-container model has
  one writer. If we split the backend across processes/containers, SQLite's
  single-writer model becomes the bottleneck. → move to Postgres.
- **Usage-metering volume.** `llm_usage` grows one row per proxied request
  forever. If per-user cost queries slow down, consider retention/rollups or a
  columnar/analytics store before a full migration.
- **Better Auth portability.** Better Auth supports multiple adapters, so an
  auth-table move to Postgres is comparatively low-risk; the risk is in *our*
  tables and the `PRAGMA user_version` migration model, which is SQLite-specific
  and would need replacing with a real migration tool.

## Per-user demo spend cap (planned follow-up)

The demo OpenAI key is capped globally at the project level, so a single heavy
demo user can exhaust it for everyone. We want a **per-anonymous-user** cap.

- Prerequisite (must be true in the anonymous-session PR): each anon user is
  **metered to its own user id**, not a collapsed `demo` bucket. `llm_usage` is
  already keyed by `userId`, so this needs no schema change — only that
  attribution routes anon users to the demo *key* while metering to their
  *individual* id.
- Enforcement: in the proxy, before calling upstream, sum the anon user's recent
  `llm_usage` and refuse (402/429) over a threshold. Disclosure to demo users
  should already say usage is capped and errors are expected when exceeded.
