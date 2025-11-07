# BugSink Error Tracking Setup

This document describes the BugSink integration for error tracking in the writing-tools application.

## What is BugSink?

BugSink is a self-hosted error tracking solution that's compatible with Sentry's open-source SDKs. It captures errors, exceptions, and performance data from both the frontend and backend without sending data to third-party services.

## Architecture

The setup includes:

1. **BugSink Server** - Web interface for viewing errors (runs on port 8000)
2. **PostgreSQL Database** - Stores error data
3. **Backend Integration** - Python/FastAPI with Sentry SDK
4. **Frontend Integration** - React/TypeScript with Sentry SDK

## Quick Start

### 1. Set Environment Variables

Create or update your `.env` file in the project root:

```bash
# BugSink Configuration (optional - has defaults for development)
BUGSINK_DB_PASSWORD=your_secure_password_here
BUGSINK_SECRET_KEY=your_random_50_character_secret_key_here
BUGSINK_ADMIN=admin:your_admin_password

# Sentry DSN (you'll get these after starting BugSink)
SENTRY_DSN=http://your-dsn-key@localhost:8000/1
VITE_SENTRY_DSN=http://your-dsn-key@localhost:8000/2
```

**Note**: For development, you can skip setting these initially. The docker-compose file has sensible defaults.

### 2. Start All Services

```bash
docker compose up -d
```

This will start:
- `bugsink-db` - PostgreSQL database
- `bugsink` - BugSink web interface (http://localhost:8000)
- `backend` - Your FastAPI server
- `frontend` - Your React application

### 3. Access BugSink Dashboard

1. Open http://localhost:8000 in your browser
2. Login with default credentials:
   - Username: `admin`
   - Password: `admin` (or whatever you set in `BUGSINK_ADMIN`)

### 4. Create Projects and Get DSN Keys

After logging in to BugSink:

1. **Create a Backend Project**:
   - Click "Create Project"
   - Name: "Writing Tools Backend"
   - Platform: Python
   - Copy the DSN (looks like `http://abc123@localhost:8000/1`)
   - Add this to your `.env` file as `SENTRY_DSN`

2. **Create a Frontend Project**:
   - Click "Create Project"
   - Name: "Writing Tools Frontend"
   - Platform: JavaScript/React
   - Copy the DSN
   - Add this to your `.env` file as `VITE_SENTRY_DSN`

3. **Restart Services** to pick up the new environment variables:
   ```bash
   docker compose restart backend frontend
   ```

### 5. Install Dependencies

#### Backend
```bash
uv sync
```

#### Frontend
```bash
cd frontend && npm install
```

## Testing the Integration

### Test Backend Error Tracking

You can trigger a test error to verify backend integration:

```python
import sentry_sdk
sentry_sdk.capture_message("Test error from backend!")
```

Or cause an actual error in your API and check if it appears in BugSink.

### Test Frontend Error Tracking

Open the browser console and run:

```javascript
throw new Error("Test error from frontend!");
```

Check the BugSink dashboard - you should see the error appear within a few seconds.

## What Gets Tracked?

### Backend (Python/FastAPI)
- Unhandled exceptions
- FastAPI request errors
- Custom error captures via `sentry_sdk.capture_exception()`
- Performance traces (10% sampled)
- API endpoint performance

### Frontend (React/TypeScript)
- JavaScript errors and exceptions
- React component errors
- Network request failures
- User sessions with errors (100% replay capture)
- Performance traces (10% sampled)
- Session replays (10% sampled)

## Common Use Cases

### Tracking OpenAI API Rate Limits

The backend integration will automatically capture errors when the OpenAI API runs out of credits or hits rate limits. These will appear in BugSink with full context including:

- Error message (e.g., "insufficient_quota")
- API endpoint that was called
- Request parameters (sanitized to remove sensitive data)
- Stack trace
- User context (if available)

### Tracking Frontend Crashes

All frontend errors are captured including:
- Office.js integration errors
- Network failures
- React rendering errors
- User interactions leading to errors

## Configuration Details

### Backend Configuration

Located in `backend/server.py`:

```python
sentry_sdk.init(
    dsn=SENTRY_DSN,
    integrations=[FastApiIntegration()],
    traces_sample_rate=0.1,  # Sample 10% of transactions
    profiles_sample_rate=0.1,  # Sample 10% for profiling
    environment=os.getenv("ENVIRONMENT", "development"),
)
```

### Frontend Configuration

Located in `frontend/src/sentry.ts`:

```typescript
Sentry.init({
    dsn: SENTRY_DSN,
    integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration(),
    ],
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    environment: import.meta.env.MODE || 'development',
});
```

## Production Deployment

For production deployment:

1. **Change default passwords**:
   ```bash
   BUGSINK_DB_PASSWORD=<strong-random-password>
   BUGSINK_SECRET_KEY=<random-50-character-string>
   BUGSINK_ADMIN=admin:<strong-admin-password>
   ```

2. **Set up HTTPS** (recommended):
   - Use a reverse proxy like Nginx
   - Update `BEHIND_HTTPS_PROXY=true` in docker-compose.yml
   - Update `BASE_URL` to your production domain

3. **Update environment**:
   ```bash
   ENVIRONMENT=production
   ```

4. **Consider external PostgreSQL** for better reliability and backups

## Disabling Error Tracking

To disable error tracking (e.g., for local development):

1. Remove or comment out the `SENTRY_DSN` and `VITE_SENTRY_DSN` variables from `.env`
2. Restart the services

The application will log that error tracking is disabled and continue working normally.

## Troubleshooting

### Errors Not Appearing in BugSink

1. Check that BugSink is running: `docker compose ps`
2. Verify DSN is correctly set in `.env`
3. Check service logs: `docker compose logs backend` or `docker compose logs frontend`
4. Ensure you restarted services after updating `.env`

### BugSink Won't Start

1. Check if port 8000 is already in use
2. Check database logs: `docker compose logs bugsink-db`
3. Try recreating containers: `docker compose down && docker compose up -d`

### Can't Access BugSink Dashboard

1. Verify BugSink is healthy: `docker compose ps bugsink`
2. Check firewall settings
3. Try accessing from localhost: http://localhost:8000

## Additional Resources

- [BugSink Documentation](https://www.bugsink.com/docs/)
- [Sentry Python SDK](https://docs.sentry.io/platforms/python/)
- [Sentry JavaScript SDK](https://docs.sentry.io/platforms/javascript/guides/react/)
