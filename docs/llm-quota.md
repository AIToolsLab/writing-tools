# Per-user LLM spend caps

Every account has a daily and a weekly cap on LLM spend, so no single user (or a
runaway client) can run up the OpenAI bill. Implemented in `backend/src/quota.ts`,
enforced in the OpenAI proxy (`backend/src/openaiProxy.ts`).

## Decisions

| | |
|---|---|
| Default caps | $0.50/day, $1.00/week. Not yet set from real data: check the per-user distribution in `/api/usage_summary` and revisit. |
| Resets | 7:00 a.m. campus time (`QUOTA_TIMEZONE`, default `America/Detroit`): daily every day, weekly on Mondays. A 7 a.m. reset makes a late-night session count as one day. |
| Over the cap | Not an error. The proxy swaps in a cheaper model (`FALLBACK_MODEL`, `gpt-6-luna`) for every request until the window resets. |
| Hard stop | At 3× a cap (`HARD_LIMIT_MULTIPLIER`), requests are refused with `429 quota_exceeded` and `Retry-After`. On the fallback model that takes a lot of use. It's a backstop against runaway clients, not a limit people should reach. |
| Grace period | The cap is checked *before* each request, so the request that crosses the line always finishes. Overshoot is one request, or a few if a user has several in flight (several tabs, an external tool). |
| What writers see | Percentages and reset times, **never dollars**: a notice above the page content at ≥ 80% (`nearing`), on fallback, and when blocked, plus an "AI usage" section on the account page. |
| Allowed requests | The proxy refuses any model without a rate in `pricing.ts` (`400 model_not_allowed`), any `service_tier` priced above Standard (`400 service_tier_not_allowed`), and Responses `background: true` (`400 background_not_allowed`). The cap counts dollars, and each of these would be spend it can't see or would under-count. |
| Realtime voice | Unmetered: audio goes browser → OpenAI directly, so the cap can't see it. Refused (`403 voice_unavailable`) for every capped account and every demo user (anonymous or sessionless, even though the demo key is separately capped). Only accounts marked exempt can use it. |
| Shared buckets | The sessionless `demo` bucket and local-dev `anonymous` bucket aren't people and aren't capped. The demo key's OpenAI project limit covers `demo`. Anonymous demo *sessions* each have their own id and are capped like anyone else. |

## App-wide daily budget

On top of the per-user caps, one daily budget covers **all** spend: every user,
exempt accounts, and demo traffic (`APP_DAILY_CAP_USD`, default $20, same 7 a.m.
reset). It's a guard against a sudden influx of users. The OpenAI hard limit is
monthly, so it can't stop one bad day from using up the month.

- Past $20, everyone is on the fallback model.
- Past 1.5× ($30, `APP_HARD_LIMIT_MULTIPLIER`), every request is refused with
  `429 app_quota_exceeded`. That's lower than the per-user 3× because this is a
  real budget, and on luna the extra $10 still covers thousands of requests.
- There's no "nearing" state: writers can't do anything about the app's budget.
- A user is held to whichever limit is stricter. `scope: 'app' | 'user'` in
  `/api/me/quota` says which, and the notice, account page and error copy say "AI
  use across the app" rather than "you've used…".

The check sums every row since the day's reset on each request, with no cache. A
covering index (db.ts v6) keeps that around 1ms for a few thousand rows a day.
Measured on a dev container with a year of history (730k rows), it grows
linearly: ~0.4ms at 2k rows/day, ~4ms at 20k, ~23ms at 100k. A plain `ts` index
was about twice as slow at volume, and slower than a full scan at 100k rows/day.
A test checks that the query plan stays on the covering index.

## Overrides (by hand, for now)

```sql
-- Raise one user's weekly cap (NULL columns keep the default)
INSERT INTO user_quota (user_id, weekly_cap_usd, note) VALUES ('<user id>', 5, 'heavy pilot user');
-- No cap at all (also the only way to get realtime voice)
INSERT INTO user_quota (user_id, exempt, note) VALUES ('<user id>', 1, 'researcher');
```

Account deletion removes the row.

## How the client learns its state

Each proxied response for a capped user carries `X-Writing-Tools-Quota:
ok|nearing|fallback|blocked` (the state as of just *before* that request), and
`X-Writing-Tools-Model-Substituted: gpt-6-luna` when the model was swapped.
`authorizedFetch` feeds the header to a small store (`frontend/src/api/quota.ts`).
When the state changes, the taskpane notice fetches `GET /api/me/quota` for the
percentages and reset time.

The `X-Writing-Tools-Error: platform-auth` header is deliberately *not* set on
quota errors: external clients read it as "credential bad, sign in again".

## Known gaps

- **Cache writes.** GPT-5.6 and later models (terra, luna, sol) charge for writing
  prompt tokens to the cache. We read `input_tokens_details.cache_write_tokens` and
  the optional `…cache_write_tokens_details.ttl_30m_tokens` (field names per
  `ResponseUsage` in the `openai` SDK). When the retention split is missing, every write is
  priced at the more expensive 12-hour rate, so the cap errs toward stopping early.
- **Fallback request compatibility is untested.** The swap changes only `model`.
  If luna rejects a parameter the client sends for the main model (e.g.
  `reasoning.effort`), fallback requests will fail rather than degrade.
- **Concurrency.** Parallel requests all pass the pre-request check (see Grace period).
- **Rate changes re-price history.** Dollars are computed at read time, so
  correcting a rate in `pricing.ts` changes everyone's current-window percentage.
- Overlaps with issue #356 (request rate-limiting), which this mostly addresses by
  spend rather than by request frequency.
