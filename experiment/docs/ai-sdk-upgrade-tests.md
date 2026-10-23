# AI SDK upgrade tests

Tests in `__tests__/api/` exist so we can bump `ai` / `@ai-sdk/openai` /
`@ai-sdk/react` and know whether we broke something. Before them, nothing in
the test suite touched the SDK (`ChatPanel.test.tsx` mocks `useChat`).

## The idea

They fake OpenAI **at the HTTP layer** (`__tests__/utils/openai-fixtures.ts`
stubs `fetch`), so the real SDK code runs end to end: our route builds a
request, `@ai-sdk/openai` serializes it and parses OpenAI's response, `ai`
turns that into a UI stream, and `@ai-sdk/react`'s `useChat` consumes it.

The fixtures are in OpenAI's wire format, which doesn't change when we upgrade
the SDK. So **the rule for an upgrade is: these tests must pass before and after
without being edited.** If you have to change a test to get it green, ask
whether the app's behavior changed too.

What they check:

| Test | Catches |
| --- | --- |
| `chat-route.test.ts` | Options silently dropped or renamed: model, system prompt, `max_output_tokens`, reasoning effort, Responses vs Chat Completions endpoint |
| `chat-roundtrip.test.tsx` | Server/client stream protocol drift; provider no longer parsing OpenAI's stream; mid-stream errors (e.g. quota) turning into a silent empty reply |
| `writing-support-route.test.ts` | Structured output (`generateObject`) request/parse; error → 500 |

What they don't check: what the model actually says, and `ChatPanel`'s
rendering/timing. Still do a one-minute manual smoke test (one chat turn, one
writing-support request) after an upgrade.

The `useChat` calls in the round-trip test (`sendMessage`, `status`, `parts`)
are SDK API. If an upgrade renames them, the test needs the same edit as
`ChatPanel.tsx` — that's expected, and is the one exception to the rule above.

## Fixtures

`__tests__/fixtures/openai/`:

| File | What it is | Source |
| --- | --- | --- |
| `chat-stream.sse` | Streamed Responses API reply (reasoning item + text) | handmade |
| `chat-stream-quota-error.sse` | 200 response whose stream carries an `error` event (`insufficient_quota`) | handmade |
| `writing-support.json` | Non-streamed Responses API reply with JSON `output_text` | handmade |
| `invalid-api-key.json` | 401 error body | handmade |

The handmade ones follow the event and field shapes `@ai-sdk/openai` validates
against, plus the extra fields real responses carry (`sequence_number`,
`content_part.*`, `output_text.done`). But they're written from the schema, not
observed, so a real response may differ in ways that matter (event ordering,
fields the SDK starts depending on). Replace them with recordings when you can.

Tests derive expected text from the fixture (`streamedText`, `outputText`), so
re-recording doesn't require editing assertions.

## Recording real fixtures

You can't capture these from the browser: the browser only sees our route's UI
stream, not OpenAI's response, which is server-side. Record at the server's
`fetch` instead. The simplest way is to make the test helper pass through to
the real API once and save what comes back:

1. In `stubOpenAI` (`__tests__/utils/openai-fixtures.ts`), temporarily add a
   record mode. Sketch (untested):

   ```ts
   const realFetch = globalThis.fetch; // capture before vi.stubGlobal

   // inside the stubbed fetch, before `return respond()`:
   if (process.env.RECORD_OPENAI_FIXTURE) {
     const res = await realFetch(input, init);
     const text = await res.clone().text();
     writeFileSync(
       path.join(FIXTURE_DIR, process.env.RECORD_OPENAI_FIXTURE),
       text,
     );
     return res;
   }
   ```

   The tests stub `OPENAI_API_KEY` to `sk-test`; in record mode, skip that
   `vi.stubEnv` so the real key from the environment is used.

2. Record one test at a time, so each run writes one file:

   ```bash
   OPENAI_API_KEY=sk-... RECORD_OPENAI_FIXTURE=chat-stream.sse \
     npx vitest run __tests__/api/chat-route.test.ts

   OPENAI_API_KEY=sk-... RECORD_OPENAI_FIXTURE=writing-support.json \
     npx vitest run __tests__/api/writing-support-route.test.ts -t 'JSON-schema'

   OPENAI_API_KEY=sk-bogus RECORD_OPENAI_FIXTURE=invalid-api-key.json \
     npx vitest run __tests__/api/writing-support-route.test.ts -t 'rejects'
   ```

   (The `invalid-api-key` recording deliberately uses a bad key. The real
   response echoes part of the key back, so use an obviously fake one.)

3. Leave `chat-stream-quota-error.sse` handmade unless you catch a real one —
   you can't trigger quota exhaustion on demand. If it happens in the study,
   the raw event shows up in the server log; paste it in.

4. Remove the record mode, run the suite without a key, and commit the
   fixtures. Check them for anything you wouldn't want in the repo first
   (recorded responses contain the model's text and response IDs, but not
   your key).

Re-record when you change a route's prompt or model in a way you want the
fixture to reflect. You don't need to re-record for an SDK upgrade — that's
the point.
