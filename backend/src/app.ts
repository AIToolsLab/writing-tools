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
import { logSecret, openaiApiKey } from './config.js';
import { appendLog, deleteUserLogs, pollLogs, zipLogs } from './logging.js';
import {
	captureException,
	deletePosthogPerson,
	posthogMiddleware,
} from './posthog.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

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

	// OpenAI-compatible passthrough. The frontend's ai-sdk client posts here; we
	// only inject the server-held API key and stream the upstream response back.
	app.post('/api/openai/chat/completions', async (c) => {
		const body = await c.req.text();
		const upstream = await fetch(OPENAI_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${openaiApiKey()}`,
				'Content-Type': 'application/json',
			},
			body,
		});

		return new Response(upstream.body, {
			status: upstream.status,
			headers: {
				'Content-Type':
					upstream.headers.get('content-type') ?? 'text/event-stream',
			},
		});
	});

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

	// Delete the authenticated user's logged study data (keeps their account).
	// Removes the JSONL log file and best-effort purges their PostHog person.
	// Full account deletion is Better Auth's /api/auth delete-user route, whose
	// beforeDelete hook also calls deleteUserLogs.
	app.delete('/api/me/data', async (c) => {
		const user = await resolveUser(c);
		if (!user) return c.json({ detail: 'Unauthorized' }, 401);

		try {
			await deleteUserLogs(user.id);
		} catch (e) {
			await captureException(e, { path: '/api/me/data' });
			return c.json({ detail: 'Failed to delete log data' }, 500);
		}
		await deletePosthogPerson(user.id);
		return c.json({ message: 'Your logged data has been deleted.' });
	});

	app.get('/api/ping', (c) => c.json({ timestamp: new Date().toISOString() }));

	// Study-log viewer polling. Gated by the shared LOG_SECRET, like before.
	app.post('/api/logs_poll', async (c) => {
		const { log_positions = {}, secret = '' } = (await c.req
			.json()
			.catch(() => ({}))) as { log_positions?: Record<string, number>; secret?: string };

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

	return app;
}
