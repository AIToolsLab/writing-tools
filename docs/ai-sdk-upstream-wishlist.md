# AI SDK upstream wishlist

Things `frontend/src/api/errors.ts` and `generate.ts` do that arguably belong in
the AI SDK, written down while the reasons are fresh. **Nothing here is filed
upstream and nothing is blocked on it** — this is context for a future us who
either takes one of these to the `vercel/ai` tracker or, more likely, has to
re-derive why our error layer looks the way it does after a version bump moves
the ground again.

Versions this was written against: `ai@7.0.52`, `@ai-sdk/openai@4.0.30`,
`@ai-sdk/provider@4.0.5`, `@ai-sdk/provider-utils@5.0.21`. Line references are
to those builds in `node_modules` and will drift.

Worth saying up front what is *not* on this list: mapping a provider error code
to a sentence a writer can act on ("the AI account is out of credit, tell the
team"), and deciding whether to offer Retry. That is product copy and product
judgement, it is the reason `errors.ts` exists, and no SDK should own it.

## 1. No retry predicate, so terminal errors still cost a full backoff

`streamText` takes `maxRetries` and nothing else — there is no `shouldRetry`
hook, though `@ai-sdk/provider-utils` has the `ShouldRetryFunction` type and
`retryWithExponentialBackoff` internally.

This bites because of how `@ai-sdk/openai` classifies quota failures. An `error`
frame arriving before any output is thrown rather than streamed, and
`getStatusCode` (`@ai-sdk/openai/dist/index.js:214`) maps `insufficient_quota`
and `rate_limit` alike to **429**, which `APICallError` treats as retryable by
default (`@ai-sdk/provider/dist/index.js:52`). So a billing failure — as
terminal as an error gets, and one we deliberately show with Retry hidden — is
attempted three times with backoff before the writer is told anything. Roughly
five seconds of a spinner promising something that cannot happen.

We can't fix it locally without also giving up retries for genuinely transient
failures, since `maxRetries` is not per-error. What we'd want is either a
caller-supplied predicate, or for the provider to stop laundering
`insufficient_quota` through a status code that means "come back later".

## 2. `RetryError` buries the failure it was retrying

When the attempts run out, `ai` throws a `RetryError` whose `message` is only
`Failed after 3 attempts. Last error: …`. Describing that value directly costs
you the provider's code and its message — you get the generic
"something went wrong, try again", which is the exact opposite of the truth for
a quota failure.

`lastError` is public, so unwrapping is easy *once you know to do it*. We only
found out because an E2E test went red. It would be kinder if the wrapper
carried the last attempt's `data`/`statusCode` forward, or if the SDK shipped a
documented "describe the real cause" unwrap. See `retriedFailure` in
`errors.ts`.

## 3. `isAbortError` is in the wrong package and answers the wrong question

`@ai-sdk/provider-utils` exports `isAbortError` (`dist/index.js:1216`), which
`ai` does not re-export. Using it means taking a direct dependency on
`provider-utils` — a package we otherwise only touch transitively — for one
predicate.

And it wouldn't replace `abortKind` anyway. It doesn't walk the `cause` chain,
and it lumps `TimeoutError` in with `AbortError`, where we need them apart:
"that took too long and was stopped" and "that request was cancelled" are
different things to tell a writer, and only one of them is their own doing.

Wanted: `isAbortError` re-exported from `ai`, cause-walking, and reporting
*which* kind. We kept our own for now; the cost is that new abort spellings the
SDK learns (it already knows Next.js's `ResponseAborted`) don't reach us.

## 4. A dead network arrives in two shapes, one of them message-matched

`handleFetchError` (`provider-utils/dist/index.js:1242`) rewrites a
`TypeError: Failed to fetch` that carries a `cause` into an `APICallError` with
no status and the message `Cannot connect to API: …`. Without a `cause` it
passes the TypeError through untouched. Which one you get depends on the
runtime: undici always sets `cause`, browsers often don't.

So a caller wanting to say "check your connection" has to handle both, and the
only thing identifying the wrapped form is that message prefix — there's no
`isNetworkError`, and the wrapper doesn't set a code or a distinguishing marker
class. We match the prefix in `isNetworkFailure` and are stuck with the fact
that an upstream copy edit would silently regress it into "something went
wrong". A `NetworkError` subclass, or any stable flag, would fix that.

This one already cost us: the wrapped shape fell through to the generic message
until we went looking.

## 5. Error-body extraction is provider-shaped and stops at the HTTP boundary

`@ai-sdk/openai` parses non-2xx bodies against `openaiErrorDataSchema` and hangs
the result on `APICallError.data` — good, and we now read that first. But it
covers exactly one envelope shape and only the HTTP path. It doesn't reach
in-stream `error` frames, and it doesn't survive a proxy that re-wraps the
error (`{error:{error:{…}}}`, which ours does hit).

So `findProviderError` stays: a small recursive dig for the innermost
`{code, message}` regardless of nesting or origin. A generic "pull the provider
error out of whatever this is" helper would be the thing to upstream, and is
probably the most reusable item on this list.

`getErrorMessage` (`@ai-sdk/provider/dist/index.js:91`) is not that helper — it's
`String` / `.toString()` / `JSON.stringify`, and for an `APICallError` it returns
the class name plus message rather than what the provider actually said.

## 6. A one-version-behind model spec degrades in silence

This is what started all of it. `ai` accepts a model whose `specificationVersion`
is older than its own by wrapping it in a compatibility shim. Two versions
behind, it logs a warning — that's the console message that opened the
investigation. **One** version behind, it shims silently
(`asLanguageModelV4`, `ai/dist/index.js:811`), which is what you land on if you
bump the provider and not `ai`.

So the natural half-fix for a compatibility warning is to swap a loud mismatch
for a quiet one. Wanted: a warning for any shimmed model, or a supported way to
ask "is this model being shimmed?" — we ended up asserting it by capturing
`AI_SDK_LOG_WARNINGS` and comparing against `MockLanguageModelV4`'s spec
(`frontend/src/api/__tests__/openai.test.ts`), which works but leans on a mock
class to learn what the runtime natively speaks.
