import { GIT_COMMIT, WAVE } from './studyConfig';
import { LogPayload, LogEntry } from '@/types/study';

/**
 * Durable client-side event log.
 *
 * Events are timestamped and numbered when they are logged, queued, and
 * uploaded in batches by a single in-flight sender. An event leaves the queue
 * only after the server acknowledges it, so network blips and server restarts
 * delay events instead of dropping them.
 *
 * Unacknowledged events survive page unloads via localStorage (written only
 * when the page is hidden or unloaded, not per event) and are uploaded by the
 * next page load. Retries and that hand-off can duplicate events; `sessionId`
 * + `seq` uniquely identify each one, so dedupe on that pair in analysis.
 */

const STORAGE_KEY = 'pendingLogEntries';
const FLUSH_DELAY = 1000; // ms: batch events logged within this window
const MAX_RETRY_DELAY = 10_000; // ms
const MAX_BATCH_SIZE = 50;
const KEEPALIVE_BYTE_LIMIT = 60_000; // browsers cap keepalive bodies at 64KB total

// Unique per page load; `seq` restarts with it.
const SESSION_ID =
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

let seq = 0;
let queue: LogEntry[] = [];
let inFlight: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = FLUSH_DELAY;
let isRedirecting = false;

/**
 * Timestamp an event and queue it for upload. Never throws or blocks.
 */
export function log(payload: LogPayload): void {
  queue.push({
    ...payload,
    timestamp: new Date().toISOString(),
    wave: WAVE,
    gitCommit: GIT_COMMIT,
    sessionId: SESSION_ID,
    seq: seq++,
  });
  scheduleFlush(FLUSH_DELAY);
}

/**
 * Upload pending events (waiting up to `timeoutMs`), then navigate. Anything
 * still unsent is handed to the next page load via localStorage.
 */
export async function redirect(url: string, timeoutMs = 5000): Promise<void> {
  await Promise.race([
    flush().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  isRedirecting = true; // intentional navigation: don't prompt
  window.location.href = url;
}

export async function logThenRedirect(payload: LogPayload, url: string): Promise<void> {
  log(payload);
  await redirect(url);
}

function scheduleFlush(delay: number) {
  if (flushTimer !== null || typeof window === 'undefined') return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush().then(
      () => {
        retryDelay = FLUSH_DELAY;
      },
      (error) => {
        console.error('Failed to upload logs; will retry:', error);
        retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
        scheduleFlush(retryDelay);
      }
    );
  }, delay);
}

/** Upload the whole queue, one batch at a time. Concurrent callers share one run. */
function flush(): Promise<void> {
  inFlight ??= (async () => {
    try {
      while (queue.length > 0) {
        const batch = queue.slice(0, MAX_BATCH_SIZE);
        const response = await send(batch);
        // 4xx will fail identically forever; drop the batch rather than wedge the queue.
        if (!response.ok && response.status < 500) {
          console.error(`Dropping ${batch.length} log entries: HTTP ${response.status}`);
        } else if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        queue = queue.slice(batch.length);
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

function send(entries: LogEntry[], keepalive = false): Promise<Response> {
  return fetch('/api/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entries),
    keepalive,
  });
}

function persistQueue() {
  try {
    if (queue.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch (error) {
    console.error('Failed to persist pending logs:', error);
  }
}

/** Best-effort upload during unload: as many entries as fit under the keepalive limit. */
function sendBeforeUnload() {
  let batch = queue;
  let body = JSON.stringify(batch);
  while (body.length > KEEPALIVE_BYTE_LIMIT && batch.length > 1) {
    batch = batch.slice(0, Math.ceil(batch.length / 2));
    body = JSON.stringify(batch);
  }
  if (body.length <= KEEPALIVE_BYTE_LIMIT) {
    send(batch, true).catch(() => {});
  }
}

if (typeof window !== 'undefined') {
  // Recover entries a previous page load didn't get acknowledged.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      queue = JSON.parse(stored) as LogEntry[];
      localStorage.removeItem(STORAGE_KEY);
      scheduleFlush(0);
    }
  } catch (error) {
    console.error('Failed to recover pending logs:', error);
  }

  // Mobile browsers may kill a hidden tab without firing pagehide.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persistQueue();
  });

  window.addEventListener('pagehide', () => {
    persistQueue();
    if (queue.length > 0) sendBeforeUnload();
  });

  window.addEventListener('beforeunload', (event) => {
    if (queue.length > 0 && !isRedirecting) {
      event.preventDefault();
      event.returnValue = ''; // older browsers
    }
  });
}
