import { createMiddleware } from 'hono/factory';
import { PostHog } from 'posthog-node';

const token = (process.env.POSTHOG_PROJECT_TOKEN ?? '').trim();
const host = (process.env.POSTHOG_HOST ?? 'https://us.i.posthog.com').trim();

const posthog = new PostHog(token, { host });

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

export async function shutdownPosthog(): Promise<void> {
	try {
		await posthog.shutdown();
	} catch {
		// ignore
	}
}
