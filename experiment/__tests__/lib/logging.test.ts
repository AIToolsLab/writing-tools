import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { LogEntry } from '@/types/study';

type LoggingModule = typeof import('@/lib/logging');

// Each import is a fresh "page load" with its own session and queue.
async function loadPage(): Promise<LoggingModule> {
  vi.resetModules();
  return import('@/lib/logging');
}

const sentBatches = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body) as LogEntry[]);

describe('logging queue', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('batches events with session id and sequence numbers', async () => {
    const { log } = await loadPage();
    log({ username: 'u1', event: 'documentUpdate' });
    log({ username: 'u1', event: 'documentUpdate' });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    const batches = sentBatches(fetchMock);
    expect(batches).toHaveLength(1);
    expect(batches[0].map((e) => e.seq)).toEqual([0, 1]);
    expect(batches[0][0].sessionId).toBe(batches[0][1].sessionId);
  });

  it('keeps events queued and retries after a server error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { log } = await loadPage();
    log({ username: 'u1', event: 'taskComplete' });

    await vi.advanceTimersByTimeAsync(1000); // fails
    await vi.advanceTimersByTimeAsync(2000); // retry succeeds
    await vi.advanceTimersByTimeAsync(10_000); // nothing left to send

    const batches = sentBatches(fetchMock);
    expect(batches).toHaveLength(2);
    expect(batches[1]).toEqual(batches[0]);
  });

  it('drops a batch the server rejects with 4xx instead of retrying forever', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 400 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { log } = await loadPage();
    log({ username: 'u1', event: 'taskComplete' });

    await vi.advanceTimersByTimeAsync(20_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('hands unsent events to the next page load via localStorage', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await loadPage();
    first.log({ username: 'u1', event: 'chatMessage:user' });
    window.dispatchEvent(new Event('pagehide'));

    const stored = JSON.parse(localStorage.getItem('pendingLogEntries')!) as LogEntry[];
    expect(stored).toHaveLength(1);

    fetchMock.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
    await loadPage();
    expect(localStorage.getItem('pendingLogEntries')).toBeNull();
    await vi.advanceTimersByTimeAsync(0);

    expect(sentBatches(fetchMock)[0]).toEqual(stored);
  });

  it('flushes before redirecting', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { set href(url: string) { assign(url); } });
    const { logThenRedirect } = await loadPage();

    await logThenRedirect({ username: 'u1', event: 'taskComplete' }, '/next');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/next');
  });
});
