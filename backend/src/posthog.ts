import { createMiddleware } from 'hono/factory';
import { PostHog } from 'posthog-node';

const token = (process.env.POSTHOG_PROJECT_TOKEN ?? '').trim() || "placeholder-token";
// Defaults to PostHog US directly, NOT the e.thoughtful-ai.com reverse proxy: the
// server has no ad-blocker to evade (that's only worth it for the browser SDK), so
// the proxy added a hop that could — and did — fail on its own.
// Strip any trailing slash so building management-API URLs (deletePosthogPerson)
// can't produce a double slash — an explicitly-set POSTHOG_HOST may end in '/', and
// many reverse proxies 404 on `//api/...`.
const host =
	((process.env.POSTHOG_HOST ?? '').trim() || 'https://us.i.posthog.com').replace(
		/\/+$/,
		'',
	);

const shouldDisablePosthog = token === "placeholder-token" || process.env.DISABLE_POSTHOG === '1';

const posthog = new PostHog(token, {
	host,
	disabled: shouldDisablePosthog,
	// Telemetry must never be able to hold a request (or the whole process) open.
	// posthog-node's defaults are 10s per attempt x 4 attempts with 3s between them
	// — ~49s of hanging per flush when the ingestion host is down. Ingestion is
	// fire-and-forget analytics, so cap it at a few seconds and let the batch drop.
	requestTimeout: 3000,
	fetchRetryCount: 1,
	fetchRetryDelay: 1000,
});

export const posthogMiddleware = createMiddleware(async (c, next) => {
	// Health probes are not product analytics: they'd add a queue entry (and a
	// distinct event name) every few seconds forever.
	if (c.req.path !== '/api/ping') {
		try {
			posthog.capture({
				distinctId: 'server',
				event: `${c.req.method} ${c.req.path}`,
			});
		} catch {
			// Never let telemetry break the request path.
		}
	}
	await next();
	// Deliberately NOT `await posthog.flush()`. That made every request wait on —
	// and 500 on — a PostHog ingestion failure: flush() rejects on any non-2xx,
	// the rejection propagated out of this middleware into app.onError, and
	// because flush() serializes behind the previous flush the latency compounded
	// across concurrent requests. A transient 526 from the analytics host thereby
	// took the whole backend down, health probe included. posthog-node already
	// flushes in the background (batches of 20, or every 10s) and swallows its own
	// errors there; shutdownPosthog() drains the tail on SIGTERM.
});

export async function captureException(
	error: unknown,
	properties?: Record<string, unknown>,
): Promise<void> {
	try {
		const err = error instanceof Error ? error : new Error(String(error));
		posthog.captureException(err, undefined, properties);
		// No flush() here either — see posthogMiddleware. The background flush
		// timer sends this within ~10s without putting the ingestion host on the
		// critical path of an error response.
	} catch {
		// Never let error tracking break the request path.
	}
}

/**
 * Best-effort deletion of a user's PostHog person + events, for "delete my data".
 *
 * The capture token can't delete data; this needs the management API (a personal
 * API key + project id). When those aren't configured we no-op with a warning so
 * self-hosted/dev deletion requests still succeed for the parts we control (the
 * JSONL logs). NOTE: verify the endpoint shape against your PostHog version before
 * relying on it in production.
 */
export async function deletePosthogPerson(distinctId: string): Promise<void> {
	const personalKey = (process.env.POSTHOG_PERSONAL_API_KEY ?? '').trim();
	const projectId = (process.env.POSTHOG_PROJECT_ID ?? '').trim();
	if (!personalKey || !projectId) {
		console.warn(
			'PostHog person deletion skipped (POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID unset); delete manually if needed.',
		);
		return;
	}
	try {
		const res = await fetch(
			`${host}/api/projects/${projectId}/persons/?distinct_id=${encodeURIComponent(distinctId)}&delete_events=true`,
			{ method: 'DELETE', headers: { Authorization: `Bearer ${personalKey}` } },
		);
		// fetch only rejects on network errors — surface 4xx/5xx so a failed
		// deletion isn't silently treated as success.
		if (!res.ok) {
			await captureException(
				new Error(`PostHog person deletion failed (${res.status})`),
				{ context: 'deletePosthogPerson' },
			);
		}
	} catch (e) {
		await captureException(e, { context: 'deletePosthogPerson' });
	}
}

export async function shutdownPosthog(): Promise<void> {
	try {
		await posthog.shutdown();
	} catch {
		// ignore
	}
}
