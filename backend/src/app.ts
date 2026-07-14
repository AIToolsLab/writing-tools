import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { Auth } from './auth.js'; // type-only import, no runtime cost
import {
	type ConsentLevel,
	CONSENT_LEVELS,
	DEFAULT_CONSENT_LEVEL,
	filterExtraDataForConsent,
	isConsentLevel,
} from './consent.js';
import { gitCommit, logSecret } from './config.js';
import { eraseLoggedData } from './erasure.js';
import { appendLog, pollLogs, zipLogs } from './logging.js';
import { openaiProxy } from './openaiProxy.js';
import { captureException, posthogMiddleware } from './posthog.js';
import { costUsd } from './pricing.js';
import { summarizeUsage } from './usage.js';

export function createApp({ auth }: { auth?: Auth } = {}): Hono {
	const app = new Hono();

	// CORS stays fully permissive for now to preserve existing behaviour.
	app.use('*', cors());
	app.use('*', posthogMiddleware);

	if (auth) {
		// Better Auth owns all /api/auth/* — OAuth redirects, callbacks, sessions, sign-out
		app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

		// Permanent diagnostic route — proves cookie + Bearer session verification
		// works. Also the client's user-info fetch: includes loggingConsent so the
		// add-in can gate analytics/logging to the user's level.
		app.get('/api/protected', async (c) => {
			const session = await auth.api.getSession({ headers: c.req.raw.headers });
			if (!session) return c.json({ error: 'Unauthorized' }, 401);
			const raw = (session.user as { loggingConsent?: unknown }).loggingConsent;
			return c.json({
				id: session.user.id,
				email: session.user.email,
				name: session.user.name,
				loggingConsent: isConsentLevel(raw) ? raw : DEFAULT_CONSENT_LEVEL,
			});
		});
	}

	app.onError(async (err, c) => {
		await captureException(err, { path: c.req.path, method: c.req.method });
		return c.json({ detail: 'Internal server error' }, 500);
	});

	// OpenAI-compatible passthrough: picks the API key that pays for the request,
	// relays the upstream response unchanged, and meters token usage against the
	// paying identity (see attributeRequest in openaiProxy.ts). A session spends the
	// main key; sessionless traffic spends the capped demo key, or is refused.
	app.post(
		'/api/openai/chat/completions',
		openaiProxy('chat/completions', {
			resolveUserId: async (c) => (await resolveUser(c))?.id ?? null,
			authEnabled: !!auth,
		}),
	);

	// Resolve the authenticated user from the request's session, or null. Returns
	// null when auth is disabled (dev/tests without BETTER_AUTH_ENABLED) so the
	// caller can 401 — identity-keyed logging requires a session.
	async function resolveUser(
		c: Context,
	): Promise<{ id: string; loggingConsent: ConsentLevel } | null> {
		if (!auth) return null;
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return null;
		const raw = (session.user as { loggingConsent?: unknown }).loggingConsent;
		return {
			id: session.user.id,
			loggingConsent: isConsentLevel(raw) ? raw : DEFAULT_CONSENT_LEVEL,
		};
	}

	// Client event logging. Requires an authenticated session: the log is keyed by
	// the Better Auth user id (not a client-supplied name), and content fields are
	// stripped to the user's consent level before they ever hit disk.
	app.post('/api/log', async (c) => {
		const user = await resolveUser(c);
		if (!user) return c.json({ detail: 'Unauthorized' }, 401);

		const payload = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;

		const extraData: Record<string, unknown> = {};
		if ('timestamp' in payload) {
			extraData.client_timestamp = payload.timestamp;
			delete payload.timestamp;
		}
		// Identity comes from the session, never the client. Drop any legacy
		// username the client still sends.
		delete payload.username;

		const event = (payload.event as string) ?? 'unknown_event';
		delete payload.event;
		Object.assign(extraData, payload);

		// Server-side consent gate (the client also pre-strips). Level 'none' drops
		// the event entirely; lower levels strip content keys above their tier.
		const { allowed, extraData: gated } = filterExtraDataForConsent(
			extraData,
			user.loggingConsent,
		);
		if (!allowed) {
			return c.json({ message: 'Logging disabled by consent level.' });
		}

		// Await so we can capture write failures.
		try {
			await appendLog({
				timestamp: Date.now() / 1000,
				ok: true,
				username: user.id,
				event,
				extra_data: gated,
			});
		} catch (e) {
			await captureException(e, { path: '/api/log' });
			return c.json({ detail: 'Failed to write log entry' }, 500);
		}

		return c.json({ message: 'Feedback logged successfully.' });
	});

	// Update the authenticated user's logging-consent level. Server-controlled
	// field, so it's written via Better Auth's updateUser rather than sign-up input.
	app.post('/api/me/consent', async (c) => {
		const user = await resolveUser(c);
		if (!user || !auth) return c.json({ detail: 'Unauthorized' }, 401);

		const { level } = (await c.req.json().catch(() => ({}))) as {
			level?: unknown;
		};
		if (!isConsentLevel(level)) {
			return c.json(
				{ detail: 'Invalid consent level.', allowed: CONSENT_LEVELS },
				400,
			);
		}

		await auth.api.updateUser({
			// loggingConsent/consentUpdatedAt are `input: false`, so Better Auth
			// strips them from the client-input type even though updateUser writes
			// them server-side. Cast past that purely-type restriction.
			body: {
				loggingConsent: level,
				consentUpdatedAt: new Date(),
			} as unknown as never,
			headers: c.req.raw.headers,
		});
		return c.json({ loggingConsent: level });
	});

	// Erase the authenticated user's logged activity — study logs and analytics
	// profile — while keeping their account. This is *withdrawal*: they carry on
	// using the add-in, they just want what we've recorded about them gone.
	//
	// Not "delete my data", which is what this used to be called: it doesn't touch
	// the account, and it deliberately leaves the LLM usage rows, because the
	// account is still open and still running up a bill. Departure is Better Auth's
	// delete-user route, whose beforeDelete hook runs this same erasure and *then*
	// anonymizes the usage rows (see erasure.ts, auth.ts).
	app.delete('/api/me/activity', async (c) => {
		const user = await resolveUser(c);
		if (!user) return c.json({ detail: 'Unauthorized' }, 401);

		try {
			await eraseLoggedData(user.id);
		} catch (e) {
			await captureException(e, { path: '/api/me/activity' });
			return c.json({ detail: 'Failed to erase logged activity' }, 500);
		}
		return c.json({ message: 'Your logged activity has been erased.' });
	});

	app.get('/api/ping', (c) =>
		c.json({ timestamp: new Date().toISOString(), gitCommit: gitCommit() }),
	);

	// Study-log viewer polling. Gated by the shared LOG_SECRET, like before.
	app.post('/api/logs_poll', async (c) => {
		const { log_positions = {}, secret = '' } = (await c.req
			.json()
			.catch(() => ({}))) as {
			log_positions?: Record<string, number>;
			secret?: string;
		};

		if (logSecret() === '') {
			return c.json({ error: 'Logging secret not set.' }, 500);
		}
		if (secret !== logSecret()) {
			return c.json({ error: 'Invalid secret.' }, 403);
		}
		return c.json(await pollLogs(log_positions));
	});

	// Bulk log export as a ZIP (researcher tool, reached by direct URL).
	app.get('/api/download_logs', async (c) => {
		const secret = c.req.query('secret') ?? '';
		if (logSecret() === '') {
			return c.json({ error: 'Logging secret not set.' }, 500);
		}
		if (secret !== logSecret()) {
			return c.json({ error: 'Invalid secret.' }, 403);
		}

		const zip = await zipLogs();
		return new Response(zip, {
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': 'attachment; filename=logs.zip',
			},
		});
	});

	// LLM spend broken down by user (and model). Operator tool, gated by the same
	// LOG_SECRET as the other researcher routes. `since`/`until` are ISO dates and
	// default to the last 30 days. Dollars are computed here from the stored token
	// counts, so a model with no entry in pricing.ts reports costUsd: null and shows
	// up in `unpricedModels` rather than silently costing nothing.
	app.get('/api/usage_summary', (c) => {
		const secret = c.req.query('secret') ?? '';
		if (logSecret() === '') {
			return c.json({ error: 'Logging secret not set.' }, 500);
		}
		if (secret !== logSecret()) {
			return c.json({ error: 'Invalid secret.' }, 403);
		}

		const parseDate = (raw: string | undefined, fallback: number): number => {
			const parsed = raw ? Date.parse(raw) : Number.NaN;
			return Number.isNaN(parsed) ? fallback : parsed;
		};
		const until = parseDate(c.req.query('until'), Date.now());
		const since = parseDate(
			c.req.query('since'),
			until - 30 * 24 * 60 * 60 * 1000,
		);

		const rows = summarizeUsage(since, until).map((row) => ({
			...row,
			costUsd: costUsd(row),
		}));

		// Per-user totals; unpriced rows contribute requests but no dollars.
		const byUser = new Map<
			string,
			{ email: string | null; costUsd: number; requests: number }
		>();
		for (const row of rows) {
			const entry = byUser.get(row.userId) ?? {
				email: row.email,
				costUsd: 0,
				requests: 0,
			};
			entry.costUsd += row.costUsd ?? 0;
			entry.requests += row.requests;
			byUser.set(row.userId, entry);
		}

		return c.json({
			since: new Date(since).toISOString(),
			until: new Date(until).toISOString(),
			totals: [...byUser].map(([userId, t]) => ({ userId, ...t })),
			rows,
			unpricedModels: [
				...new Set(rows.filter((r) => r.costUsd === null).map((r) => r.model)),
			],
		});
	});

	return app;
}
