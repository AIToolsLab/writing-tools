# Writing Tools - Next.js Full-Stack Migration

This is a **full Next.js migration** of the writing-tools application, replacing both the React/Webpack frontend and Python FastAPI backend with a unified Next.js application.

## Architecture Overview

### What Changed

**Before (Hybrid):**
```
Frontend (Webpack + React)  →  Backend (Python FastAPI)
├── Multiple HTML entries   ├── OpenAI integration
├── Office.js integration   ├── SSE streaming
├── Jotai state            └── JSONL logging
└── Webpack dev proxy
```

**After (Full Next.js):**
```
Next.js Full-Stack Application
├── App Router pages (taskpane, editor, popup)
├── API routes (TypeScript)
│   ├── /api/get_suggestion
│   ├── /api/chat (SSE)
│   ├── /api/reflections
│   ├── /api/log
│   └── /api/logs_poll, /api/download_logs
├── OpenAI SDK (Node.js)
├── Jotai state management
└── Office.js integration
```

## Key Benefits

✅ **Single Codebase** - TypeScript end-to-end
✅ **Unified Types** - Zod schemas shared between frontend/backend
✅ **Simplified Deployment** - One Docker container
✅ **No CORS Issues** - Same-origin API routes
✅ **Better DX** - Hot reload for both frontend and backend
✅ **Server Actions** - Future potential for mutations
✅ **Edge Runtime** - Optional for low-latency endpoints

## Project Structure

```
nextjs-migration/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── layout.tsx                # Root layout with Jotai Provider
│   │   ├── page.tsx                  # Landing page
│   │   ├── taskpane/
│   │   │   ├── layout.tsx            # Office.js initialization
│   │   │   └── page.tsx              # Main taskpane (Draft/Chat/Revise)
│   │   ├── editor/
│   │   │   └── page.tsx              # Standalone editor (study mode)
│   │   ├── popup/
│   │   │   └── page.tsx              # Auth0 callback
│   │   ├── commands/
│   │   │   └── page.tsx              # Office ribbon commands
│   │   └── api/                      # API Routes (replaces Python backend)
│   │       ├── get_suggestion/route.ts
│   │       ├── chat/route.ts         # SSE streaming
│   │       ├── reflections/route.ts
│   │       ├── log/route.ts
│   │       ├── logs_poll/route.ts    # Protected by LOG_SECRET
│   │       ├── download_logs/route.ts
│   │       └── ping/route.ts
│   └── lib/
│       ├── types.ts                  # Zod schemas and TypeScript types
│       ├── atoms.ts                  # Jotai global state
│       ├── prompts.ts                # OpenAI prompts (migrated from Python)
│       ├── openai.ts                 # OpenAI client and suggestion logic
│       ├── logger.ts                 # JSONL logging system
│       ├── wordEditorAPI.ts          # Office.js Word API wrapper
│       └── contexts/
│           └── editorContext.tsx     # Editor API context
├── public/
│   └── manifest.xml                  # Office add-in manifest
├── logs/                             # User study logs (JSONL)
├── next.config.js                    # Next.js configuration
├── tailwind.config.js                # Tailwind CSS
├── tsconfig.json                     # TypeScript config
├── Dockerfile                        # Production Docker image
├── docker-compose.yml                # Production deployment
├── Dockerfile.dev                    # Development Docker image
└── docker-compose.dev.yml            # Development deployment
```

## Setup Instructions

### Prerequisites

- Node.js 20+
- Docker (optional, for containerized deployment)
- OpenAI API key
- Auth0 account (optional, for authentication)

### Local Development

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your credentials:
   ```env
   OPENAI_API_KEY=sk-...
   LOG_SECRET=your-secret-for-log-access
   NEXT_PUBLIC_AUTH0_DOMAIN=your-domain.auth0.com
   NEXT_PUBLIC_AUTH0_CLIENT_ID=your-client-id
   AUTH0_SECRET=your-secret
   ```

3. **Run development server:**
   ```bash
   npm run dev
   ```

   Access at: http://localhost:3000

### Docker Development

```bash
docker-compose -f docker-compose.dev.yml up --build
```

### Production Deployment

```bash
# Build and run
docker-compose up --build -d

# View logs
docker-compose logs -f

# Stop
docker-compose down
```

## API Endpoints

All endpoints are prefixed with `/api`:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ping` | GET | Health check |
| `/api/get_suggestion` | POST | Generate AI suggestions |
| `/api/chat` | POST | Streaming chat (SSE) |
| `/api/reflections` | POST | Document analysis |
| `/api/log` | POST | Log user events |
| `/api/logs_poll` | POST | Poll logs (requires `LOG_SECRET`) |
| `/api/download_logs` | GET | Download logs as ZIP (requires `LOG_SECRET`) |

### Example: Get Suggestion

```typescript
const response = await fetch('/api/get_suggestion', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'user123',
    gtype: 'example_sentences',
    doc_context: {
      beforeCursor: 'Once upon a time',
      selectedText: '',
      afterCursor: ''
    }
  })
});

const result = await response.json();
// { generation_type: 'example_sentences', result: '- ...', extra_data: {} }
```

### Example: Streaming Chat

```typescript
import { fetchEventSource } from '@microsoft/fetch-event-source';

await fetchEventSource('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    username: 'user123',
    messages: [
      { role: 'user', content: 'Help me write an introduction' }
    ]
  }),
  onmessage(msg) {
    const data = JSON.parse(msg.data);
    console.log(data.text); // Stream chunks
  }
});
```

## Office Add-in Integration

### Manifest File

The Office manifest is located at `/public/manifest.xml`. Update URLs for production:

```xml
<SourceLocation DefaultValue="https://your-domain.com/taskpane"/>
<bt:Url id="Commands.Url" DefaultValue="https://your-domain.com/commands"/>
```

### Loading the Add-in

**Development:**
1. Side-load manifest in Word
2. Ensure dev server is running on `https://localhost:3000`
3. Trust self-signed certificate

**Production:**
1. Deploy app to production URL
2. Update manifest URLs
3. Distribute manifest via Microsoft AppSource or organization

### Office.js API

The `/taskpane` route has special handling:
- `Office.onReady()` callback waits for Office.js
- `EditorContext` provides abstraction over Word API
- `wordEditorAPI` implements document operations

## User Study Mode

Access study mode via URL parameters on `/editor`:

```
/editor?page=study-task&username=USER_123&condition=p&contextToUse=true&isProlific=true
```

**Parameters:**
- `page`: Study page (e.g., `study-intro`, `study-task`)
- `username`: Participant ID
- `condition`: Condition code
  - `g` → example_sentences
  - `a` → analysis_readerPerspective
  - `p` → proposal_advice
  - `n` → no_ai
  - `f` → complete_document
- `contextToUse`: `true` | `false` | `mixed`
- `isProlific`: Show completion code

All interactions are logged to `/logs/{username}.jsonl`.

## Logging System

### Log Events

Events are logged to JSONL files in `/logs/`:

```typescript
import { logEvent } from '@/lib/logger';

await logEvent('user123', 'suggestion_generated', {
  generation_type: 'example_sentences',
  result: '...'
});
```

### Access Logs

**Poll for new logs:**
```bash
curl -X POST http://localhost:3000/api/logs_poll \
  -H "Content-Type: application/json" \
  -d '{"secret": "your-log-secret", "since": "2025-01-01T00:00:00Z"}'
```

**Download all logs:**
```bash
curl "http://localhost:3000/api/download_logs?secret=your-log-secret" \
  -o logs.zip
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `OPENAI_MODEL` | Model name (default: `gpt-4o`) | No |
| `OPENAI_TEMPERATURE` | Temperature (default: `0.7`) | No |
| `LOG_SECRET` | Secret for log access | Yes |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | Auth0 domain | Optional |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | Auth0 client ID | Optional |
| `AUTH0_SECRET` | Auth0 secret | Optional |

## Migration from Original Codebase

### Key Differences

1. **No Python Backend** - All backend logic in Next.js API routes
2. **Zod Validation** - Replaces Pydantic models
3. **TypeScript Prompts** - Prompts migrated from `backend/nlp.py` → `src/lib/prompts.ts`
4. **Node.js OpenAI SDK** - Replaces Python AsyncOpenAI
5. **Filesystem Logging** - Same JSONL format, but using Node.js `fs/promises`

### What Stayed the Same

✅ **Prompt Templates** - Identical to Python version
✅ **Suggestion Logic** - Study mode mixing preserved
✅ **Log Format** - Compatible JSONL format
✅ **API Contracts** - Same request/response shapes
✅ **Office.js Integration** - Same Word API usage

## Testing

```bash
# Type check
npm run type-check

# Lint
npm run lint

# Build (validates everything)
npm run build
```

## Performance Considerations

- **API Routes**: Use `export const runtime = 'nodejs'` for OpenAI calls
- **Streaming**: SSE implemented for chat endpoint
- **Caching**: Next.js automatic caching for static content
- **Logging**: Async logging doesn't block responses
- **Docker**: Multi-stage build for small image size

## Troubleshooting

### Office.js Not Loading

Ensure the page is accessed from Word and Office.js CDN is loaded:

```html
<script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js"></script>
```

### API Timeout

Increase timeout for long-running OpenAI calls:

```typescript
export const maxDuration = 60; // 60 seconds
```

### Logs Not Writing

Check logs directory permissions:

```bash
mkdir -p logs
chmod 755 logs
```

## Future Enhancements

- [ ] Full Lexical editor integration (from original `/editor`)
- [ ] Complete study router with all pages
- [ ] Survey components migration
- [ ] Chat message persistence
- [ ] Draft page with live suggestions
- [ ] Revise page with visualization tools
- [ ] Auth0 full integration
- [ ] Tests (Jest + React Testing Library)
- [ ] E2E tests (Playwright)

## License

Same as original writing-tools repository.

## Credits

Migrated from the original [writing-tools](https://github.com/AIToolsLab/writing-tools) repository.
