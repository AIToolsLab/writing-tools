# Quick Start Guide

Get the Next.js migration running in 5 minutes.

## Prerequisites

- Node.js 20+
- OpenAI API key

## Option 1: Local Development (Fastest)

```bash
# 1. Install dependencies
npm install

# 2. Create .env file
cat > .env << EOF
OPENAI_API_KEY=sk-your-key-here
LOG_SECRET=my-secret-123
NEXT_PUBLIC_AUTH0_DOMAIN=your-domain.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=your-client-id
AUTH0_SECRET=your-auth0-secret
EOF

# 3. Run dev server
npm run dev
```

Open http://localhost:3000

**Test API:**
```bash
curl http://localhost:3000/api/ping
# Should return: {"timestamp":"...","status":"ok"}
```

## Option 2: Docker Development

```bash
# 1. Create .env file (same as above)

# 2. Run with Docker Compose
docker-compose -f docker-compose.dev.yml up --build

# Access at http://localhost:3000
```

## Option 3: Production Docker

```bash
# 1. Create .env file

# 2. Build and run
docker-compose up --build -d

# 3. Check logs
docker-compose logs -f

# 4. Stop
docker-compose down
```

## Testing the API

### 1. Ping Endpoint
```bash
curl http://localhost:3000/api/ping
```

### 2. Get Suggestion
```bash
curl -X POST http://localhost:3000/api/get_suggestion \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_user",
    "gtype": "example_sentences",
    "doc_context": {
      "beforeCursor": "Once upon a time",
      "selectedText": "",
      "afterCursor": ""
    }
  }'
```

Expected response:
```json
{
  "generation_type": "example_sentences",
  "result": "- in a faraway land...\n\n- there lived a curious child...\n\n- the world was much different...",
  "extra_data": {}
}
```

### 3. Chat Stream
```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "username": "test_user",
    "messages": [
      {"role": "user", "content": "Help me write an introduction"}
    ]
  }'
```

Expected response (streaming):
```
data: {"text":"Sure"}

data: {"text":","}

data: {"text":" I"}

...

data: [DONE]
```

## Accessing Different Pages

- **Home**: http://localhost:3000
- **Editor**: http://localhost:3000/editor
- **Taskpane** (requires Office.js): http://localhost:3000/taskpane
- **Study Mode**: http://localhost:3000/editor?page=study-task&username=user123&condition=p

## Viewing Logs

Logs are stored in `/logs` directory as JSONL files:

```bash
# View logs for a user
cat logs/test_user.jsonl

# Pretty print logs
cat logs/test_user.jsonl | jq

# Tail live logs
tail -f logs/test_user.jsonl
```

## Office Add-in Setup (Optional)

### Development

1. **Generate SSL certificate:**
   ```bash
   npm install -g office-addin-dev-certs
   office-addin-dev-certs install
   ```

2. **Update manifest URLs** in `public/manifest.xml`:
   ```xml
   <SourceLocation DefaultValue="https://localhost:3000/taskpane"/>
   ```

3. **Side-load manifest in Word:**
   - Word → Insert → Add-ins → Upload My Add-in
   - Select `public/manifest.xml`

4. **Start dev server with HTTPS:**
   ```bash
   npm run dev
   ```

### Production

1. **Update manifest URLs** to your production domain
2. **Deploy** to production server
3. **Distribute** manifest via AppSource or organization

## Troubleshooting

### Port Already in Use

```bash
# Find process using port 3000
lsof -ti:3000

# Kill it
kill -9 $(lsof -ti:3000)
```

### OpenAI API Errors

```bash
# Test API key
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Docker Issues

```bash
# Clean up Docker
docker-compose down -v
docker system prune -a

# Rebuild from scratch
docker-compose up --build --force-recreate
```

### Logs Not Writing

```bash
# Check directory permissions
ls -la logs/

# Create directory if missing
mkdir -p logs
chmod 755 logs
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | Yes | - | OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o` | Model to use |
| `OPENAI_TEMPERATURE` | No | `0.7` | Temperature (0-2) |
| `LOG_SECRET` | Yes | - | Secret for log access |
| `NEXT_PUBLIC_AUTH0_DOMAIN` | No | - | Auth0 domain |
| `NEXT_PUBLIC_AUTH0_CLIENT_ID` | No | - | Auth0 client ID |
| `AUTH0_SECRET` | No | - | Auth0 secret |

## Next Steps

1. ✅ **Read README.md** for full documentation
2. ✅ **Read MIGRATION_GUIDE.md** to understand the migration
3. ✅ **Read COMPARISON.md** for Python vs Next.js comparison
4. 🚀 **Start building!**

## Common Commands

```bash
# Development
npm run dev              # Start dev server
npm run build            # Build for production
npm run start            # Start production server
npm run lint             # Lint code
npm run type-check       # Check TypeScript types

# Docker
docker-compose up        # Start production
docker-compose up -d     # Start in background
docker-compose logs -f   # View logs
docker-compose down      # Stop containers

# Testing
curl http://localhost:3000/api/ping                    # Health check
curl -X POST http://localhost:3000/api/get_suggestion  # Test suggestion
curl -N -X POST http://localhost:3000/api/chat         # Test chat stream
```

## Support

- **Issues**: https://github.com/AIToolsLab/writing-tools/issues
- **Docs**: See README.md, MIGRATION_GUIDE.md, COMPARISON.md
