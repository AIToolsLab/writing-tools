import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import type { Auth, SessionUser } from './auth.js'; // type-only import, no runtime cost
import {
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
import { isUserAllowed } from './userAllowlist.js';

// Shared gate for the researcher/operator routes (log viewer + usage summary).
// Returns an error Response to short-circuit, or null when the secret is valid.
function logSecretGate(c: Context, provided: string): Response | null {
	if (logSecret() === '') {
		return c.json({ error: 'Logging secret not set.' }, 500);
	}
	if (provided !== logSecret()) {
		return c.json({ error: 'Invalid secret.' }, 403);
	}
	return null;
}

export function createApp({ auth }: { auth?: Auth } = {}): Hono {
	const app = new Hono();

	// CORS stays fully permissive for now to preserve existing behaviour.
	app.use('*', cors());
	app.use('*', posthogMiddleware);

	if (auth) {
		// Better Auth owns all /api/auth/* — OAuth redirects, callbacks, sessions, sign-out.
		// Clients (and the debug pages) read the signed-in user, including our
		// loggingConsent additionalField, straight from GET /api/auth/get-session.
		app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));
	}

	app.onError(async (err, c) => {
		// Also log to stderr: PostHog alone made route errors invisible during
		// development (and container logs are the first place anyone looks).
		console.error(`[${c.req.method} ${c.req.path}]`, err);
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
			// The proxy only reads { id, isAnonymous }; resolveUser also returns
			// loggingConsent, which is structurally compatible and simply ignored here.
			resolveUser,
			authEnabled: !!auth,
		}),
	);
	// Responses API — same attribution, metering, and key selection, just a
	// different upstream endpoint.
	app.post(
		'/api/openai/responses',
		openaiProxy('responses', {
			resolveUser,
			authEnabled: !!auth,
		}),
	);

	// Resolve the authenticated user from the request's session, or null. Returns
	// null when auth is disabled (dev/tests without BETTER_AUTH_ENABLED) so the
	// caller can 401 — identity-keyed logging requires a session. `isAnonymous`
	// distinguishes demo sessions (see the anonymous plugin in auth.ts): they log
	// and meter like any user, but their model spend goes to the capped demo key.
	async function resolveUser(
		c: Context,
	): Promise<SessionUser | null> {
		if (!auth) return null;
		const session = await auth.api.getSession({ headers: c.req.raw.headers });
		if (!session) return null;
		const u = session.user as {
			loggingConsent?: unknown;
			isAnonymous?: unknown;
			email?: string | null;
			alwaysAllow?: unknown;
		};
		const isAnonymous = u.isAnonymous === true;
		return {
			id: session.user.id,
			loggingConsent: isConsentLevel(u.loggingConsent)
				? u.loggingConsent
				: DEFAULT_CONSENT_LEVEL,
			isAnonymous,
			// Recompute from the same policy the customSession flag uses, so proxy
			// enforcement doesn't depend on the customSession endpoint override.
			isAllowed: isUserAllowed({
				email: u.email,
				isAnonymous,
				alwaysAllow: u.alwaysAllow === true,
			}),
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

		// Schema version and page are promoted to first-class columns so readers
		// can version-branch and filter per page without parsing extra_data.
		// Pre-schema clients omit them: default the version to 0 and page to null.
		const schemaVersion =
			typeof payload.schema_version === 'number' ? payload.schema_version : 0;
		delete payload.schema_version;
		const page = typeof payload.page === 'string' ? payload.page : null;
		delete payload.page;

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
				schema_version: schemaVersion,
				page,
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

		// loggingConsent/consentUpdatedAt are `input: false`, which the public
		// updateUser endpoint enforces at RUNTIME (FIELD_NOT_ALLOWED), not just in
		// the types — so a server-controlled field can't be written through it.
		// We use the same write path Better Auth uses internally for its OWN
		// /update-user route (ctx.context.internalAdapter.updateUser — see
		// better-auth/dist/api/routes/update-user.mjs); the public endpoint is that
		// call plus the client-input guard we intentionally skip here. Not part of
		// Better Auth's documented public API, but its own mechanism. A raw SQL
		// UPDATE via our db() connection was rejected as more fragile — it would
		// bypass Better Auth's date serialization and any user hooks.
		const ctx = await auth.$context;
		await ctx.internalAdapter.updateUser(user.id, {
			loggingConsent: level,
			consentUpdatedAt: new Date(),
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

		const gate = logSecretGate(c, secret);
		if (gate) return gate;
		return c.json(await pollLogs(log_positions));
	});

	// Bulk log export as a ZIP (researcher tool, reached by direct URL).
	app.get('/api/download_logs', async (c) => {
		const secret = c.req.query('secret') ?? '';
		const gate = logSecretGate(c, secret);
		if (gate) return gate;

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
		const gate = logSecretGate(c, secret);
		if (gate) return gate;

		const parseDate = (raw: string | undefined, fallback: number): number => {
			const parsed = raw ? Date.parse(raw) : Number.NaN;
			return Number.isNaN(parsed) ? fallback : parsed;
		};
		// The window is half-open [since, until) so adjacent reports don't
		// double-count a boundary row. That makes the default upper bound `now + 1`,
		// not `now`: a request metered in this very millisecond has ts === now, and a
		// bare `now` (exclusive) would drop it — silently under-reporting the most
		// recent spend, the whole point of the default window.
		const until = parseDate(c.req.query('until'), Date.now() + 1);
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
