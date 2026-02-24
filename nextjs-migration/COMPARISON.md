# Side-by-Side Comparison: Python vs Next.js

This document shows key files side-by-side to illustrate the migration.

## 1. OpenAI Suggestion Logic

### Python (`backend/nlp.py`)

```python
async def get_suggestion(prompt_name: str, doc_context: DocContext) -> GenerationResult:
    # Special handling for complete_document
    if prompt_name == "complete_document":
        full_prompt = get_full_prompt(prompt_name, doc_context, use_false_context=True)
        completion = await openai_client.chat.completions.create(
            **MODEL_PARAMS,
            messages=[
                {"role": "system", "content": "You are a helpful and insightful writing assistant."},
                {"role": "user", "content": full_prompt}
            ]
        )
        result = completion.choices[0].message.content
        return GenerationResult(generation_type=prompt_name, result=result, extra_data={})

    # If falseContextData is None/empty, use baseline behavior
    if not doc_context.falseContextData:
        full_prompt = get_full_prompt(prompt_name, doc_context)
        completion = await openai_client.chat.completions.parse(
            **MODEL_PARAMS,
            messages=[
                {"role": "system", "content": "You are a helpful and insightful writing assistant."},
                {"role": "user", "content": full_prompt},
            ],
            response_format=ListResponse,
        )
        suggestion_response = completion.choices[0].message.parsed
        markdown_response = "\n\n".join([f"- {item}" for item in suggestion_response.responses])
        return GenerationResult(generation_type=prompt_name, result=markdown_response, extra_data={})

    # Study mode: parallel calls with mixing
    true_suggestions, false_suggestions = await asyncio.gather(
        _get_suggestions_from_context(prompt_name, doc_context, use_false_context=False),
        _get_suggestions_from_context(prompt_name, doc_context, use_false_context=True)
    )

    # ... mixing logic with deterministic shuffle ...

    return GenerationResult(generation_type=prompt_name, result=markdown_response, extra_data=extra_data)
```

### TypeScript (`src/lib/openai.ts`)

```typescript
export async function getSuggestion(
  promptName: GenerationType,
  docContext: DocContext
): Promise<GenerationResult> {
  // Special handling for complete_document
  if (promptName === 'complete_document') {
    const fullPrompt = getFullPrompt(promptName, docContext, { useFalseContext: true });

    const completion = await openai.chat.completions.create({
      ...MODEL_PARAMS,
      messages: [
        { role: 'system', content: 'You are a helpful and insightful writing assistant.' },
        { role: 'user', content: fullPrompt },
      ],
    });

    const result = completion.choices[0].message.content;
    return { generation_type: promptName, result, extra_data: {} };
  }

  // If falseContextData is None/empty, use baseline behavior
  if (!docContext.falseContextData || docContext.falseContextData.length === 0) {
    const fullPrompt = getFullPrompt(promptName, docContext);

    const completion = await openai.chat.completions.create({
      ...MODEL_PARAMS,
      messages: [
        { role: 'system', content: 'You are a helpful and insightful writing assistant.' },
        { role: 'user', content: fullPrompt },
      ],
      response_format: listResponseSchema,
    });

    const content = completion.choices[0].message.content;
    const parsed = JSON.parse(content) as { responses: string[] };
    const markdownResponse = parsed.responses.map((item) => `- ${item}`).join('\n\n');

    return { generation_type: promptName, result: markdownResponse, extra_data: {} };
  }

  // Study mode: parallel calls with mixing
  const [trueSuggestions, falseSuggestions] = await Promise.all([
    getSuggestionsFromContext(promptName, docContext, false),
    getSuggestionsFromContext(promptName, docContext, true),
  ]);

  // ... same mixing logic with deterministic shuffle ...

  return { generation_type: promptName, result: markdownResponse, extra_data: extraData };
}
```

**Key Changes:**
- `asyncio.gather` → `Promise.all`
- Snake_case → camelCase
- Dictionary → Object
- Type hints → TypeScript types
- `**MODEL_PARAMS` → `...MODEL_PARAMS`

---

## 2. API Endpoint

### Python (`backend/server.py`)

```python
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel

app = FastAPI()

@app.post("/api/get_suggestion")
async def get_suggestion_endpoint(
    request: SuggestionRequestWithDocContext,
    background_tasks: BackgroundTasks,
) -> GenerationResult:
    logger.info(f"Received suggestion request from user: {request.username}")

    # Handle no_ai condition
    if request.gtype == "no_ai":
        return GenerationResult(
            generation_type="no_ai",
            result="AI assistance is not available in this condition.",
            extra_data={},
        )

    result = await get_suggestion(request.gtype, request.doc_context)

    # Log request asynchronously
    background_tasks.add_task(
        log_request,
        request.username,
        "suggestion_generated",
        {
            "generation_type": request.gtype,
            "result": result.result,
            "doc_context": request.doc_context.model_dump() if request.username else None,
        },
    )

    return result
```

### TypeScript (`src/app/api/get_suggestion/route.ts`)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { SuggestionRequestSchema } from '@/lib/types';
import { getSuggestion } from '@/lib/openai';
import { logEvent } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate request with Zod
    const validationResult = SuggestionRequestSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.error.errors },
        { status: 400 }
      );
    }

    const { username, gtype, doc_context } = validationResult.data;

    // Handle no_ai condition
    if (gtype === 'no_ai') {
      return NextResponse.json({
        generation_type: 'no_ai',
        result: 'AI assistance is not available in this condition.',
        extra_data: {},
      });
    }

    // Get suggestion from OpenAI
    const result = await getSuggestion(gtype, doc_context);

    // Log the event asynchronously (don't await)
    logEvent(username, 'suggestion_generated', {
      generation_type: gtype,
      result: result.result,
      doc_context: username ? doc_context : { ...doc_context, beforeCursor: '[REDACTED]' },
    }).catch((err) => console.error('Failed to log event:', err));

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('Error in /api/get_suggestion:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}
```

**Key Changes:**
- FastAPI decorator → Next.js Route Handler
- `BackgroundTasks` → Fire-and-forget `.catch()`
- Automatic Pydantic validation → Manual Zod validation
- Logger → `console.error`
- Return object → `NextResponse.json()`

---

## 3. Streaming Chat

### Python (`backend/server.py`)

```python
from sse_starlette.sse import EventSourceResponse

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequestPayload) -> EventSourceResponse:
    logger.info(f"Received chat request from user: {request.username}")

    # Log request
    await log_request(
        request.username,
        "chat_message",
        {"messages": [msg.model_dump() for msg in request.messages]},
    )

    # Create event generator for SSE
    async def event_generator():
        stream = chat_stream(request.messages, temperature=0.7)
        full_response = ""

        async for chunk in stream:
            text = chunk.choices[0].delta.content or ""
            full_response += text
            yield {"data": json.dumps({"text": text})}

        # Log complete response
        await log_request(request.username, "chat_response", {"response": full_response})

    return EventSourceResponse(event_generator())
```

### TypeScript (`src/app/api/chat/route.ts`)

```typescript
import { NextRequest } from 'next/server';
import { ChatRequestSchema } from '@/lib/types';
import { chatStream } from '@/lib/openai';
import { logEvent } from '@/lib/logger';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validationResult = ChatRequestSchema.safeParse(body);

    if (!validationResult.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request' }),
        { status: 400 }
      );
    }

    const { username, messages } = validationResult.data;

    // Log the chat request asynchronously
    logEvent(username, 'chat_message', { messages }).catch(console.error);

    // Create SSE stream
    const stream = await chatStream(messages);
    const encoder = new TextEncoder();

    const readable = new ReadableStream({
      async start(controller) {
        let fullResponse = '';

        for await (const chunk of stream) {
          const text = chunk.choices[0]?.delta?.content || '';
          fullResponse += text;

          const sseData = `data: ${JSON.stringify({ text })}\n\n`;
          controller.enqueue(encoder.encode(sseData));
        }

        // Log complete response
        logEvent(username, 'chat_response', { response: fullResponse }).catch(console.error);

        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
```

**Key Changes:**
- `EventSourceResponse` → Web `ReadableStream`
- `async def event_generator()` → `ReadableStream.start()`
- `yield {"data": ...}` → `controller.enqueue()`
- Auto SSE formatting → Manual `data: ...\n\n`

---

## 4. Data Validation

### Python (Pydantic)

```python
from pydantic import BaseModel, Field
from typing import Optional, List

class ContextSection(BaseModel):
    title: str
    content: str

class DocContext(BaseModel):
    contextData: Optional[List[ContextSection]] = None
    falseContextData: Optional[List[ContextSection]] = None
    beforeCursor: str
    selectedText: str
    afterCursor: str

class ValidatedUsername(str):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v):
        if not isinstance(v, str):
            raise TypeError('string required')
        if len(v) > 50:
            raise ValueError('must be <= 50 characters')
        if not v.replace('_', '').replace('-', '').isalnum():
            raise ValueError('must be alphanumeric with _ or -')
        return v

class SuggestionRequestWithDocContext(BaseModel):
    username: ValidatedUsername
    gtype: str
    doc_context: DocContext
```

### TypeScript (Zod)

```typescript
import { z } from 'zod';

export const ContextSectionSchema = z.object({
  title: z.string(),
  content: z.string(),
});

export const DocContextSchema = z.object({
  contextData: z.array(ContextSectionSchema).optional().nullable(),
  falseContextData: z.array(ContextSectionSchema).optional().nullable(),
  beforeCursor: z.string(),
  selectedText: z.string(),
  afterCursor: z.string(),
});

export const SuggestionRequestSchema = z.object({
  username: z.string()
    .min(1, 'Username is required')
    .max(50, 'Username must be 50 characters or less')
    .regex(/^[a-zA-Z0-9_-]*$/, 'Username must be alphanumeric with _ or -'),
  gtype: z.enum([
    'example_sentences',
    'proposal_advice',
    'analysis_readerPerspective',
    'complete_document',
    'no_ai'
  ]),
  doc_context: DocContextSchema,
});

export type DocContext = z.infer<typeof DocContextSchema>;
export type SuggestionRequest = z.infer<typeof SuggestionRequestSchema>;
```

**Key Changes:**
- Custom validators → Built-in Zod methods
- Runtime + type hints → Inferred TypeScript types
- Automatic validation → Manual `.safeParse()`
- Error raising → Error object returned

**Advantages:**
- ✅ Better error messages in Zod
- ✅ Type inference (`z.infer<typeof Schema>`)
- ✅ Composable schemas
- ✅ Transform and refine methods

---

## 5. Logging

### Python

```python
import json
from pathlib import Path

LOGS_DIR = Path("logs")

async def log_request(username: str, event: str, data: dict):
    log_file = LOGS_DIR / f"{username}.jsonl"
    log_entry = {
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "username": username,
        "event": event,
        **data,
    }

    # Append to file
    with open(log_file, "a") as f:
        json.dump(log_entry, f)
        f.write("\n")
```

### TypeScript

```typescript
import { promises as fs } from 'fs';
import path from 'path';

const LOGS_DIR = path.join(process.cwd(), 'logs');

export async function logEvent(
  username: string,
  event: string,
  data: Record<string, any> = {}
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    username,
    event,
    ...data,
  };

  const logLine = JSON.stringify(logEntry) + '\n';
  const logFile = path.join(LOGS_DIR, `${username}.jsonl`);

  await fs.appendFile(logFile, logLine, 'utf-8');
}
```

**Key Changes:**
- `pathlib.Path` → `path.join()`
- `with open()` context manager → `fs.appendFile()`
- `**data` → `...data`
- Sync file I/O → Async `promises` API

**Result:** Identical JSONL format!

---

## 6. Project Structure

### Python Backend

```
backend/
├── server.py          # 280 lines - FastAPI app
├── nlp.py            # 378 lines - OpenAI logic
├── gunicorn.conf.py  # Gunicorn config
├── Dockerfile        # Python image
└── logs/             # JSONL logs
```

### Next.js Full-Stack

```
nextjs-migration/
├── src/
│   ├── app/
│   │   ├── api/                    # Replaces server.py
│   │   │   ├── get_suggestion/route.ts
│   │   │   ├── chat/route.ts
│   │   │   ├── reflections/route.ts
│   │   │   └── log/route.ts
│   │   ├── taskpane/page.tsx       # Office add-in UI
│   │   └── editor/page.tsx         # Standalone editor
│   └── lib/
│       ├── openai.ts               # Replaces nlp.py
│       ├── prompts.ts              # Prompt templates
│       ├── logger.ts               # Logging system
│       └── types.ts                # Replaces Pydantic models
├── Dockerfile                      # Node.js image
└── logs/                           # JSONL logs (compatible!)
```

**Lines of Code:**

| Component | Python | TypeScript | Change |
|-----------|--------|------------|--------|
| Backend logic | 378 | 420 | +11% |
| API routes | 280 | 350 | +25% |
| Types/Validation | 80 | 150 | +88% (more detailed) |
| **Total** | **738** | **920** | **+25%** |

More lines, but:
- ✅ More type safety
- ✅ Better error handling
- ✅ Clearer structure

---

## Summary

| Aspect | Python | Next.js | Winner |
|--------|--------|---------|--------|
| Lines of code | 738 | 920 | Python (shorter) |
| Type safety | Partial | Full | Next.js |
| Async syntax | `async/await` | `async/await` | Tie |
| Validation | Pydantic (auto) | Zod (manual) | Pydantic (easier) |
| Error messages | OK | Excellent | Next.js |
| Hot reload | Backend only | Full-stack | Next.js |
| Deployment | 2 services | 1 service | Next.js |
| Docker image | 450MB | 350MB | Next.js (smaller) |
| Type inference | Decent | Excellent | Next.js |
| Frontend sharing | No | Yes | Next.js |

**Overall:** Next.js wins for this use case because:
1. Same-origin (no CORS)
2. Shared types across frontend/backend
3. Simpler deployment
4. Better TypeScript DX

**Python would win if:**
- Need NumPy/pandas/scipy
- Heavy ML workloads
- Python-only libraries required
