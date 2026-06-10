import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import {
	authEnabled,
	betterAuthSecret,
	DEBUG,
	googleClientId,
	googleClientSecret,
	openaiApiKey,
	PORT,
} from './config.js';
import { shutdownPosthog } from './posthog.js';

if (!openaiApiKey()) {
	console.warn('OPENAI_API_KEY is not set; /api/openai/* requests will fail.');
}

// Startup validation — fail fast if auth is enabled but misconfigured.
if (authEnabled()) {
	if (!betterAuthSecret()) {
		console.error(
			'BETTER_AUTH_SECRET is required when BETTER_AUTH_ENABLED=true',
		);
		process.exit(1);
	}
	if (!googleClientId() || !googleClientSecret()) {
		console.error(
			'GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required when auth is enabled',
		);
		process.exit(1);
	}
}

// Import the auth singleton only when enabled. The dynamic import means auth.ts
// (and its SQLite connection) is never executed when auth is disabled or in tests.
const auth = authEnabled() ? (await import('./auth.js')).auth : undefined;
const app = createApp({ auth });

// Debug UI — only when auth is enabled AND DEBUG=true. Registered here (not in
// createApp) so it never appears in the test environment.
if (auth && DEBUG) {
	const { debugAuthHandler } = await import('./routes/debug.js');
	app.get('/api/debug/auth', debugAuthHandler);
}

const server = serve(
	{ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' },
	(info) => console.log(`Backend listening on ${info.address}:${info.port}`),
);

function shutdown(exitCode = 0): void {
	server.close(async (err?: Error) => {
		if (err) console.error('Error closing server:', err);
		// Flush PostHog after all requests are done so no captures are lost.
		await shutdownPosthog();
		process.exit(exitCode);
	});
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
