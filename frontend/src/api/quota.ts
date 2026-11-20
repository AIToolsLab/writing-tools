/**
 * The writer's AI spend-cap standing (backend/src/quota.ts).
 *
 * Two ways in:
 *   - Every proxied model response carries `X-Writing-Tools-Quota: <state>` for a
 *     capped user. authorizedFetch hands each response to noteQuotaHeader, which
 *     keeps the latest state in a tiny store — so the taskpane learns it's
 *     nearing the cap from the requests it was making anyway, without polling.
 *   - `GET /api/me/quota` gives the detail (percent per window, reset times) for
 *     the notice and the account page.
 *
 * Writers see percentages and reset times only, never dollars.
 */
import { useSyncExternalStore } from 'react';

export type QuotaState = 'ok' | 'nearing' | 'fallback' | 'blocked';

export interface QuotaWindow {
	percentUsed: number;
	/** ISO timestamp. */
	resetsAt: string;
}

export interface QuotaStatus {
	/** False when the account has no cap (exempt, or a dev server with auth off). */
	capped: boolean;
	state: QuotaState;
	/** Whose limit set `state`: the writer's own, or the app-wide daily budget. */
	scope: 'user' | 'app';
	daily: QuotaWindow | null;
	weekly: QuotaWindow | null;
	/** When the current state lifts; null when uncapped. */
	resetsAt: string | null;
}

export const QUOTA_STATE_HEADER = 'X-Writing-Tools-Quota';

const STATES: readonly QuotaState[] = ['ok', 'nearing', 'fallback', 'blocked'];

function isQuotaState(value: unknown): value is QuotaState {
	return STATES.includes(value as QuotaState);
}

// --- header signal --------------------------------------------------------------

let signal: QuotaState | null = null;
const listeners = new Set<() => void>();

/** Record the quota state a proxied response reported, if it reported one. */
export function noteQuotaHeader(res: Response): void {
	const value = res.headers.get(QUOTA_STATE_HEADER);
	if (!isQuotaState(value) || value === signal) return;
	signal = value;
	for (const listener of listeners) listener();
}

/** The latest quota state seen on a model response; null until one arrives. */
export function useQuotaSignal(): QuotaState | null {
	return useSyncExternalStore(
		(listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		() => signal,
	);
}

/** Test hook: forget the last seen state. */
export function resetQuotaSignal(): void {
	signal = null;
}

// --- detail ----------------------------------------------------------------------

function parseWindow(value: unknown): QuotaWindow | null {
	const w = value as Partial<QuotaWindow> | null;
	if (!w || typeof w.percentUsed !== 'number' || typeof w.resetsAt !== 'string') {
		return null;
	}
	return { percentUsed: w.percentUsed, resetsAt: w.resetsAt };
}

/** Validate a `GET /api/me/quota` body. Throws on a malformed one. */
export function parseQuotaStatus(data: unknown): QuotaStatus {
	const d = data as Record<string, unknown> | null;
	if (!d || typeof d.capped !== 'boolean' || !isQuotaState(d.state)) {
		throw new Error('malformed quota response');
	}
	return {
		capped: d.capped,
		state: d.state,
		scope: d.scope === 'app' ? 'app' : 'user',
		daily: parseWindow(d.daily),
		weekly: parseWindow(d.weekly),
		resetsAt: typeof d.resetsAt === 'string' ? d.resetsAt : null,
	};
}

/** `GET /api/me/quota` through the given (authenticated) fetch. */
export async function fetchQuota(
	url: string,
	fetchImpl: (input: string, init?: RequestInit) => Promise<Response>,
): Promise<QuotaStatus> {
	const res = await fetchImpl(url, { credentials: 'omit' });
	if (!res.ok) throw new Error(`quota fetch failed (${res.status})`);
	return parseQuotaStatus(await res.json());
}

/** The more-used window and how to name it in a sentence. */
export function busiestWindow(
	status: QuotaStatus,
): { label: 'today' | 'this week'; window: QuotaWindow } | null {
	const { daily, weekly } = status;
	if (!daily && !weekly) return null;
	if (weekly && (!daily || weekly.percentUsed >= daily.percentUsed)) {
		return { label: 'this week', window: weekly };
	}
	return { label: 'today', window: daily! };
}

/** A reset time as the writer would say it: "Monday 7:00 AM". */
export function formatReset(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		weekday: 'long',
		hour: 'numeric',
		minute: '2-digit',
	});
}
