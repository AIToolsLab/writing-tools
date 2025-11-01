# Architecture Deep Dive

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Application                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │   Taskpane   │  │    Editor    │  │    Popup     │    │
│  │ (Office.js)  │  │  (Standalone)│  │   (Auth0)    │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                  │                  │             │
│         └──────────────────┴──────────────────┘             │
│                           │                                 │
│                    ┌──────▼──────┐                         │
│                    │   Jotai     │                         │
│                    │ State Atoms │                         │
│                    └──────┬──────┘                         │
│                           │                                 │
│         ┌─────────────────┴─────────────────┐              │
│         │                                   │              │
│    ┌────▼────┐                         ┌────▼────┐        │
│    │  Word   │                         │  Lexical│        │
│    │EditorAPI│                         │  Editor │        │
│    └─────────┘                         └─────────┘        │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                       API Routes                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  /api/get_suggestion  /api/chat  /api/reflections         │
│  /api/log  /api/logs_poll  /api/download_logs             │
│                                                             │
│                    ┌────────────┐                          │
│                    │    Zod     │                          │
│                    │ Validation │                          │
│                    └──────┬─────┘                          │
│                           │                                 │
│                    ┌──────▼──────┐                         │
│                    │   OpenAI    │                         │
│                    │   Client    │                         │
│                    └──────┬──────┘                         │
│                           │                                 │
│                    ┌──────▼──────┐                         │
│                    │   Logger    │                         │
│                    │  (JSONL)    │                         │
│                    └─────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │  OpenAI API   │
                    │   (GPT-4o)    │
                    └───────────────┘
```

## Request Flow

### 1. Suggestion Generation

```
┌─────────┐     ┌────────────┐     ┌──────────┐     ┌──────────┐
│  User   │────▶│  Taskpane  │────▶│   API    │────▶│  OpenAI  │
│ (Word)  │     │ Component  │     │  Route   │     │  Client  │
└─────────┘     └────────────┘     └──────────┘     └──────────┘
     │                │                   │                │
     │                │                   │                │
     ▼                ▼                   ▼                ▼
  Clicks        Calls Word API     Validates with    Generates
  "Generate"    getDocContext()    Zod schema        suggestions
                                                          │
                                                          │
┌─────────┐     ┌────────────┐     ┌──────────┐        │
│  User   │◀────│  Taskpane  │◀────│   API    │◀───────┘
│ (Word)  │     │ Displays   │     │  Route   │
└─────────┘     └────────────┘     └──────────┘
                                         │
                                         ▼
                                   ┌──────────┐
                                   │  Logger  │
                                   │  (async) │
                                   └──────────┘
```

### 2. Chat Streaming

```
┌─────────┐     ┌────────────┐     ┌──────────┐     ┌──────────┐
│  User   │────▶│   Chat     │────▶│   API    │────▶│  OpenAI  │
│         │     │ Component  │     │  Route   │     │  Stream  │
└─────────┘     └────────────┘     └──────────┘     └──────────┘
                      │                   │                │
                      │                   │                │
     ┌────────────────┘                   ▼                ▼
     │                              ReadableStream    Async Iterator
     │                                    │                │
     │                                    ▼                │
     │                              SSE Encoder            │
     │                                    │                │
     │                                    │◀───────────────┘
     │                                    │
     ▼                                    ▼
fetchEventSource()                  Chunks streamed
  onmessage()                       data: {"text":"..."}
```

## Data Flow

### Study Mode (Mixed Context)

```
┌─────────────────────────────────────────────────────────────┐
│                    User Study Request                       │
├─────────────────────────────────────────────────────────────┤
│  username: "USER_123"                                       │
│  condition: "p" (proposal_advice)                           │
│  contextToUse: "mixed"                                      │
│  doc_context: {                                             │
│    contextData: [true context]                              │
│    falseContextData: [false context]                        │
│    beforeCursor: "..."                                      │
│  }                                                           │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│               Parallel OpenAI Calls                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌────────────────────┐      ┌────────────────────┐       │
│  │   True Context     │      │   False Context    │       │
│  │   OpenAI Call      │      │   OpenAI Call      │       │
│  └────────┬───────────┘      └────────┬───────────┘       │
│           │                            │                    │
│           └──────────┬─────────────────┘                    │
│                      │                                      │
│                      ▼                                      │
│           ┌──────────────────────┐                         │
│           │  [3 true, 3 false]   │                         │
│           │    suggestions       │                         │
│           └──────────┬───────────┘                         │
│                      │                                      │
│                      ▼                                      │
│           ┌──────────────────────┐                         │
│           │ Deterministic Shuffle│                         │
│           │  (hash-based seed)   │                         │
│           └──────────┬───────────┘                         │
│                      │                                      │
│                      ▼                                      │
│           ┌──────────────────────┐                         │
│           │ Select 3 (mixed)     │                         │
│           │ - At least 1 true    │                         │
│           │ - At least 1 false   │                         │
│           └──────────────────────┘                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                       Response                              │
├─────────────────────────────────────────────────────────────┤
│  {                                                          │
│    generation_type: "proposal_advice",                      │
│    result: "- Suggestion 1\n\n- Suggestion 2\n\n...",     │
│    extra_data: {                                            │
│      shuffle_seed: 123456,                                  │
│      suggestion_sources: [                                  │
│        { content: "...", source: "true", index: 0 },       │
│        { content: "...", source: "false", index: 1 },      │
│        { content: "...", source: "true", index: 2 }        │
│      ],                                                     │
│      total_true_suggestions: 2,                             │
│      total_false_suggestions: 1                             │
│    }                                                        │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                      ┌──────────┐
                      │  Logger  │
                      │  (async) │
                      └──────────┘
```

## Component Hierarchy

### Taskpane

```
RootLayout (Jotai Provider)
└── TaskpaneLayout (Office.js initialization)
    └── EditorContext.Provider (wordEditorAPI)
        └── TaskpanePage
            ├── Navigation (Draft/Chat/Revise tabs)
            ├── DraftPage
            │   ├── Get suggestions button
            │   └── Suggestion list
            ├── ChatPage
            │   ├── Message list
            │   └── Input + Send button
            └── RevisePage
                └── Analysis buttons
```

### Editor

```
RootLayout (Jotai Provider)
└── EditorPage
    ├── Study mode detection (URL params)
    ├── EditorContext.Provider (mockEditorAPI)
    ├── Header
    ├── Main editor area
    │   └── Lexical editor (future)
    └── Sidebar
        └── AI suggestions panel
```

## State Management

### Jotai Atoms

```typescript
// Global state atoms
pageNameAtom: PageName            // Current tab (Draft/Chat/Revise)
overallModeAtom: OverallMode      // full | demo | study
usernameAtom: string              // User/participant ID
studyDataAtom: StudyData | null   // Study configuration
authTokenAtom: string | null      // Auth0 access token
chatMessagesAtom: ChatMessage[]   // Chat history

// Derived atoms (future)
isStudyModeAtom = atom((get) => get(overallModeAtom) === OverallMode.study)
isAuthenticatedAtom = atom((get) => get(authTokenAtom) !== null)
```

### Context Providers

```typescript
// EditorContext - provides editor API
interface EditorAPI {
  getDocContext(): Promise<DocContext>
  addSelectionChangeHandler(handler): void
  selectPhrase(text: string): Promise<void>
  doLogin(auth0Client): Promise<void>
  doLogout(auth0Client): Promise<void>
}

// Two implementations:
// 1. wordEditorAPI - Office.js Word API
// 2. mockEditorAPI - In-memory for standalone editor
```

## API Route Patterns

### Standard POST Route

```typescript
// /api/{endpoint}/route.ts
export const runtime = 'nodejs';
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate
    const body = await request.json();
    const result = Schema.safeParse(body);
    if (!result.success) {
      return NextResponse.json({ error: '...' }, { status: 400 });
    }

    // 2. Process request
    const data = await processRequest(result.data);

    // 3. Log asynchronously
    logEvent(...).catch(console.error);

    // 4. Return response
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ error: '...' }, { status: 500 });
  }
}
```

### Streaming Route (SSE)

```typescript
// /api/chat/route.ts
export async function POST(request: NextRequest) {
  const stream = await chatStream(messages);

  const readable = new ReadableStream({
    async start(controller) {
      for await (const chunk of stream) {
        const data = `data: ${JSON.stringify(chunk)}\n\n`;
        controller.enqueue(encoder.encode(data));
      }
      controller.close();
    }
  });

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    }
  });
}
```

## Security Considerations

### 1. API Route Protection

- Username validation (alphanumeric + `_` + `-`)
- Rate limiting (future: via middleware)
- LOG_SECRET for admin endpoints

### 2. Office.js Security

- Manifest restrictions (allowed domains)
- HTTPS required for production
- Frame-ancestors CSP header

### 3. Data Privacy

- Redact document text for non-study users
- Async logging (non-blocking)
- JSONL files (one per user)

## Performance Optimizations

### 1. API Routes

```typescript
// Use Node.js runtime for OpenAI calls (not Edge)
export const runtime = 'nodejs';

// Set max duration for long-running requests
export const maxDuration = 60; // 60 seconds
```

### 2. Docker Build

```dockerfile
# Multi-stage build
FROM node:20-alpine AS deps     # Install dependencies
FROM node:20-alpine AS builder  # Build application
FROM node:20-alpine AS runner   # Run application

# Result: 350MB image (vs 450MB Python)
```

### 3. Next.js Optimizations

- Automatic code splitting
- Image optimization (future)
- Static generation for marketing pages
- API route caching (future)

## Monitoring & Logging

### Application Logs

```typescript
// Console logs (Docker)
console.log('[INFO]', message);
console.error('[ERROR]', error);

// View logs
docker-compose logs -f
```

### User Event Logs

```typescript
// JSONL format
{
  "timestamp": "2025-01-01T00:00:00.000Z",
  "username": "USER_123",
  "event": "suggestion_generated",
  "generation_type": "example_sentences",
  "result": "...",
  "extra_data": {...}
}

// One file per user
logs/USER_123.jsonl
```

### Health Check

```bash
# Ping endpoint
curl http://localhost:3000/api/ping

# Docker healthcheck
healthcheck:
  test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/api/ping"]
  interval: 30s
  timeout: 10s
  retries: 3
```

## Deployment Architecture

### Development

```
┌─────────────────┐
│  Next.js Dev    │
│  (port 3000)    │
│                 │
│  - Hot reload   │
│  - Source maps  │
│  - Debug mode   │
└─────────────────┘
```

### Production (Docker)

```
┌──────────────────────────────────────┐
│         Nginx / Load Balancer        │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│       Next.js Container (3000)       │
├──────────────────────────────────────┤
│  - Standalone mode                   │
│  - Node.js 20                        │
│  - 350MB image                       │
│  - Auto-restart                      │
└────────────┬─────────────────────────┘
             │
             ▼
┌──────────────────────────────────────┐
│         Volume: /app/logs            │
│       (persistent JSONL files)       │
└──────────────────────────────────────┘
```

## Future Enhancements

### 1. Database Integration

```typescript
// Replace JSONL with PostgreSQL
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

await prisma.log.create({
  data: {
    username,
    event,
    timestamp: new Date(),
    data: JSON.stringify(extraData),
  }
});
```

### 2. Caching Layer

```typescript
// Redis for OpenAI response caching
import { Redis } from '@upstash/redis';

const redis = new Redis({...});

const cacheKey = `suggestion:${hash(request)}`;
const cached = await redis.get(cacheKey);
if (cached) return cached;

const result = await getSuggestion(...);
await redis.set(cacheKey, result, { ex: 3600 }); // 1 hour
```

### 3. Rate Limiting

```typescript
// Middleware for rate limiting
import { Ratelimit } from '@upstash/ratelimit';

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '10 s'),
});

const { success } = await ratelimit.limit(username);
if (!success) {
  return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
}
```

### 4. Edge Runtime

```typescript
// For low-latency endpoints
export const runtime = 'edge';

// Limitations:
// - No fs access
// - No Node.js APIs
// - Smaller bundle size
```

## Conclusion

This architecture provides:

✅ **Type Safety**: End-to-end TypeScript
✅ **Scalability**: Stateless API routes
✅ **Maintainability**: Clear separation of concerns
✅ **Performance**: Optimized Docker builds
✅ **Security**: Validated inputs, protected endpoints
✅ **Observability**: Comprehensive logging
