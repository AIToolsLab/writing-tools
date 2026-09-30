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
 *
 * `redirect()` refuses to leave the page until the queue has drained;
 * `subscribeLogStatus()` lets the UI explain the wait when uploads are failing.
 */

const STORAGE_KEY = 'pendingLogEntries';
const FLUSH_DELAY = 1000; // ms: batch events logged within this window
const MAX_RETRY_DELAY = 10_000; // ms
const MAX_BATCH_SIZE = 50;
const KEEPALIVE_BYTE_LIMIT = 60_000; // browsers cap keepalive bodies at 64KB total

// Unique per page load; `seq` restarts with it. (getRandomValues, unlike
// randomUUID, also works outside secure contexts, e.g. dev over plain HTTP.)
const SESSION_ID = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
  b.toString(16).padStart(2, '0')
).join('');

let seq = 0;
let queue: LogEntry[] = [];
let inFlight: Promise<void> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = FLUSH_DELAY;
let isRedirecting = false;

export interface LogStatus {
  /** A redirect is waiting for pending events to upload. */
  redirectPending: boolean;
  /** The most recent upload attempt failed. */
  failing: boolean;
}

const SERVER_STATUS: LogStatus = { redirectPending: false, failing: false };
let status: LogStatus = SERVER_STATUS;
const statusListeners = new Set<() => void>();

function setStatus(update: Partial<LogStatus>) {
  const next = { ...status, ...update };
  if (next.redirectPending === status.redirectPending && next.failing === status.failing) return;
  status = next;
  statusListeners.forEach((listener) => listener());
}

/** For useSyncExternalStore. */
export function subscribeLogStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}
export const getLogStatus = (): LogStatus => status;
export const getServerLogStatus = (): LogStatus => SERVER_STATUS;

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
 * Wait until every pending event has uploaded (retrying indefinitely), then
 * navigate. Participants can't advance while logging is failing.
 */
export async function redirect(url: string): Promise<void> {
  setStatus({ redirectPending: true });
  for (;;) {
    try {
      await flush();
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
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
      setStatus({ failing: false });
    } catch (error) {
      setStatus({ failing: true });
      throw error;
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
