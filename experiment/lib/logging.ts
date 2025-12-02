import { GIT_COMMIT, WAVE } from './studyConfig';
import { LogPayload, LogEntry } from '@/types/study';

const MAX_RETRIES = 3;
const INITIAL_DELAY = 100; // ms

/**
 * Enrich payload with metadata and send to server
 */
export async function log(payload: LogPayload): Promise<void> {
  const entry: LogEntry = {
    ...payload,
    timestamp: new Date().toISOString(),
    wave: WAVE,
    gitCommit: GIT_COMMIT,
  };

  await sendLogWithRetry(entry);
}

/**
 * Log an event and then navigate to a URL
 */
export async function logThenRedirect(
  payload: LogPayload,
  url: string
): Promise<void> {
  try {
    await log(payload);
  } catch (error) {
    console.error('Failed to log before redirect:', error);
    // Continue with redirect even if logging fails
  }

  window.location.href = url;
}

/**
 * Send log entry to server with retry logic
 */
async function sendLogWithRetry(entry: LogEntry, attempt = 0): Promise<void> {
  try {
    const response = await fetch('/api/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
      keepalive: true,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    if (attempt < MAX_RETRIES - 1) {
      const delay = INITIAL_DELAY * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return sendLogWithRetry(entry, attempt + 1);
    }

    console.error(`Failed to log after ${MAX_RETRIES} attempts:`, error);
  }
}
