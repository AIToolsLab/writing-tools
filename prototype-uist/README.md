# User-Owned Words Writing Coach

A standalone prototype for writing with AI under hard authorship constraints.
The AI can coach, extract candidate wording from the user's own chat or voice
messages, and suggest where approved text should go. It cannot write novel
document prose into the draft.

## Core workflow

1. The user talks or types in the chat panel.
2. The AI replies as a coach and proposes candidate snippets copied from the
   latest user message.
3. Proposed snippets enter the word bank only if the bank guardrail proves they
   match user-owned wording.
4. The user approves, rejects, or edits bank items.
5. The AI suggests a placement target.
6. The document insert tool writes only the exact approved bank text.

## Guardrails

- AI bank writes must validate against user messages.
- User manual bank edits count as user-owned text.
- Document inserts must exactly equal the current approved bank item text.
- Validation is deterministic string grounding, not semantic similarity.

## Run

This prototype uses the existing `backend/` OpenAI proxy.

```sh
# 1. Start the backend from the repo root
cd backend
npm run dev

# 2. In another terminal, run the standalone prototype
cd prototype-uist
npm install
npm run dev
```

Optional backend override:

```sh
VITE_BACKEND_URL=http://localhost:8000/api npm run dev
```

Voice input uses the browser speech recognition API and works best in Chrome or
Edge.

## Test

```sh
npm test
```
