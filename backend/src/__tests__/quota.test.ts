import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Auth, SessionUser } from '../auth.js';
import { CONSENT_LEVELS } from '../consent.js';
import { closeDb, db } from '../db.js';
import {
	MODEL_SUBSTITUTED_HEADER,
	QUOTA_RESETS_HEADER,
	QUOTA_STATE_HEADER,
} from '../openaiProxy.js';
import {
	FALLBACK_MODEL,
	publicStatus,
	quotaStatus,
	quotaWindows,
} from '../quota.js';
import { DEMO_USER_ID, recordUsage } from '../usage.js';

const TZ = 'America/Detroit';
const iso = (ms: number) => new Date(ms).toISOString();

/** Spend `usd` for `userId` now, as gpt-5.6-terra output tokens ($12 / 1M). */
function spend(userId: string, usd: number, model = 'gpt-5.6-terra'): void {
	recordUsage({
		userId,
		clientId: null,
		provider: 'openai',
		endpoint: 'responses',
		model,
		inputTokens: 0,
		cachedInputTokens: 0,
		outputTokens: Math.round((usd / 12) * 1_000_000),
		reasoningTokens: 0,
		status: 200,
		streamed: true,
		durationMs: 1,
		ttftMs: 1,
	});
}

function appWithUser(user: SessionUser | null) {
	const auth = {
		handler: async () => new Response(null),
		api: { getSession: async () => (user ? { user } : null) },
	} as unknown as Auth;
	return createApp({ auth });
}

const real = (id: string) =>
	({
		id,
		email: `${id}@calvin.edu`,
		isAnonymous: false,
		loggingConsent: CONSENT_LEVELS[2],
		isAllowed: true,
		clientId: null,
	}) as SessionUser;

/** Upstream stub that echoes success and records the body it was sent. */
function stubUpstream() {
	const fetchMock = vi.fn(
		async (_url: string, _init: RequestInit) =>
			new Response(
				JSON.stringify({
					model: FALLBACK_MODEL,
					usage: { input_tokens: 10, output_tokens: 5 },
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } },
			),
	);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function proxyRequest(app: ReturnType<typeof createApp>, model: string) {
	return app.request('/api/openai/responses', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model, input: 'hi' }),
	});
}

beforeEach(async () => {
	vi.stubEnv('DATA_DIR', await mkdtemp(path.join(tmpdir(), 'wt-quota-')));
	vi.stubEnv('OPENAI_API_KEY', 'test-key');
	vi.stubEnv('QUOTA_TIMEZONE', TZ);
});

afterEach(() => {
	closeDb();
});

describe('quotaWindows', () => {
	it('starts the day at 7am local and the week on Monday 7am', () => {
		// Wed 2026-11-18 10:00 EST (UTC-5).
		const w = quotaWindows(Date.parse('2026-11-18T15:00:00Z'), TZ);
		expect(iso(w.dayStart)).toBe('2026-11-18T12:00:00.000Z');
		expect(iso(w.dayEnd)).toBe('2026-11-19T12:00:00.000Z');
		expect(iso(w.weekStart)).toBe('2026-11-16T12:00:00.000Z');
		expect(iso(w.weekEnd)).toBe('2026-11-23T12:00:00.000Z');
	});

	it('counts the hours before 7am as the previous day — and week', () => {
		// Mon 2026-11-16 06:00 EST: still Sunday's quota day, so last week.
		const w = quotaWindows(Date.parse('2026-11-16T11:00:00Z'), TZ);
		expect(iso(w.dayStart)).toBe('2026-11-15T12:00:00.000Z');
		expect(iso(w.weekStart)).toBe('2026-11-09T12:00:00.000Z');
		expect(iso(w.weekEnd)).toBe('2026-11-16T12:00:00.000Z');
	});

	it('keeps 7am local across a DST change', () => {
		// Sat 2026-03-07 10:00 EST; DST starts Sun 03-08, so Sunday 7am is EDT (UTC-4).
		const w = quotaWindows(Date.parse('2026-03-07T15:00:00Z'), TZ);
		expect(iso(w.dayStart)).toBe('2026-03-07T12:00:00.000Z');
		expect(iso(w.dayEnd)).toBe('2026-03-08T11:00:00.000Z');
		expect(iso(w.weekEnd)).toBe('2026-03-09T11:00:00.000Z');
	});
});

describe('quotaStatus', () => {
	it('moves ok → nearing → fallback → blocked on the daily cap ($0.50)', () => {
		expect(quotaStatus('u').state).toBe('ok');
		spend('u', 0.42); // 84% of the day
		expect(quotaStatus('u').state).toBe('nearing');
		spend('u', 0.1); // 104%
		expect(quotaStatus('u').state).toBe('fallback');
		spend('u', 1.0); // 304% of the day
		expect(quotaStatus('u').state).toBe('blocked');
	});

	it('honours a per-user override, and exempt users have no cap', () => {
		spend('u', 0.6);
		expect(quotaStatus('u').state).toBe('fallback');
		db()
			.prepare(`INSERT INTO user_quota (user_id, daily_cap_usd, weekly_cap_usd) VALUES ('u', 2, 5)`)
			.run();
		expect(quotaStatus('u').state).toBe('ok');
		db().prepare(`UPDATE user_quota SET exempt = 1 WHERE user_id = 'u'`).run();
		expect(quotaStatus('u')).toMatchObject({ capped: false, state: 'ok' });
	});

	it('leaves a NULL override column at the default', () => {
		db().prepare(`INSERT INTO user_quota (user_id, weekly_cap_usd) VALUES ('u', 5)`).run();
		spend('u', 0.6); // over the (default) daily cap
		expect(quotaStatus('u').state).toBe('fallback');
	});

	it('does not cap the shared demo bucket', () => {
		spend(DEMO_USER_ID, 10);
		expect(quotaStatus(DEMO_USER_ID).capped).toBe(false);
	});

	it('costs unpriced history conservatively rather than as free', () => {
		recordUsage({
			userId: 'u',
			clientId: null,
			provider: 'openai',
			endpoint: 'responses',
			model: 'some-retired-model',
			inputTokens: 25_000,
			cachedInputTokens: 0,
			outputTokens: 25_000,
			reasoningTokens: 0,
			status: 200,
			streamed: false,
			durationMs: 1,
			ttftMs: null,
		});
		// 50k tokens at the most expensive output rate (terra's $12/1M) = $0.60: over the day's $0.50.
		expect(quotaStatus('u').state).toBe('fallback');
	});

	it('tells the client percentages and reset times, never dollars', () => {
		spend('u', 0.25);
		const pub = publicStatus(quotaStatus('u'));
		expect(pub.daily?.percentUsed).toBe(50);
		expect(pub.weekly?.percentUsed).toBe(25);
		expect(JSON.stringify(pub)).not.toMatch(/usd/i);
	});
});

describe('proxy enforcement', () => {
	it('serves an under-cap user the model they asked for', async () => {
		const fetchMock = stubUpstream();
		const res = await proxyRequest(appWithUser(real('u')), 'gpt-6.2-sol');
		expect(res.status).toBe(200);
		expect(res.headers.get(QUOTA_STATE_HEADER)).toBe('ok');
		expect(res.headers.get(QUOTA_RESETS_HEADER)).toBeNull();
		expect(res.headers.get(MODEL_SUBSTITUTED_HEADER)).toBeNull();
		const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
		expect(sent.model).toBe('gpt-6.2-sol');
	});

	it('swaps in the fallback model once a user is over a cap', async () => {
		spend('u', 0.6);
		const fetchMock = stubUpstream();
		const res = await proxyRequest(appWithUser(real('u')), 'gpt-6.2-sol');
		expect(res.status).toBe(200);
		expect(res.headers.get(QUOTA_STATE_HEADER)).toBe('fallback');
		expect(res.headers.get(MODEL_SUBSTITUTED_HEADER)).toBe(FALLBACK_MODEL);
		// Over the daily cap only, so the state lifts at the next daily reset.
		expect(res.headers.get(QUOTA_RESETS_HEADER)).toBe(
			new Date(quotaWindows(Date.now()).dayEnd).toISOString(),
		);
		const sent = JSON.parse(String(fetchMock.mock.calls[0]![1].body));
		expect(sent.model).toBe(FALLBACK_MODEL);
		expect(sent.input).toBe('hi'); // the rest of the request is untouched
	});

	it('refuses at the hard limit with a retry time, without calling upstream', async () => {
		spend('u', 1.6); // > 3 × the $0.50 daily cap
		const fetchMock = stubUpstream();
		const res = await proxyRequest(appWithUser(real('u')), 'gpt-6.2-sol');
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ error: { code: 'quota_exceeded' } });
		expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
		expect(Date.parse(String(res.headers.get(QUOTA_RESETS_HEADER)))).toBeGreaterThan(
			Date.now(),
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('GET /api/me/quota', () => {
	it('requires a session', async () => {
		const res = await appWithUser(null).request('/api/me/quota');
		expect(res.status).toBe(401);
	});

	it("returns the signed-in user's standing", async () => {
		spend('u', 0.45);
		const res = await appWithUser(real('u')).request('/api/me/quota');
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			capped: true,
			state: 'nearing',
			daily: { percentUsed: 90 },
		});
	});
});
