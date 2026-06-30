import { createMiddleware } from 'hono/factory';
import { PostHog } from 'posthog-node';

const token = (process.env.POSTHOG_PROJECT_TOKEN ?? '').trim() || "placeholder-token";
const host = (process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com').trim();

const shouldDisablePosthog = token === "placeholder-token" || process.env.DISABLE_POSTHOG === '1';

const posthog = new PostHog(token, { host, disabled: shouldDisablePosthog });

export const posthogMiddleware = createMiddleware(async (c, next) => {
	posthog.capture({
		distinctId: 'server',
		event: `${c.req.method} ${c.req.path}`,
	});
	await next();
	await posthog.flush();
});

export async function captureException(
	error: unknown,
	properties?: Record<string, unknown>,
): Promise<void> {
	try {
		const err = error instanceof Error ? error : new Error(String(error));
		posthog.captureException(err, undefined, properties);
		await posthog.flush();
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
		await fetch(
			`${host}/api/projects/${projectId}/persons/?distinct_id=${encodeURIComponent(distinctId)}&delete_events=true`,
			{ method: 'DELETE', headers: { Authorization: `Bearer ${personalKey}` } },
		);
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
