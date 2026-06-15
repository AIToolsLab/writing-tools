import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import {
	authEnabled,
	betterAuthSecret,
	DEBUG,
	deviceClientIds,
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
	if (deviceClientIds().length === 0) {
		console.warn(
			'BETTER_AUTH_DEVICE_CLIENT_IDS is empty — all device code requests will be rejected.',
		);
	}
}

// Import the auth singleton only when enabled. The dynamic import means auth.ts
// (and its SQLite connection) is never executed when auth is disabled or in tests.
const auth = authEnabled() ? (await import('./auth.js')).auth : undefined;
const app = createApp({ auth });

// if auth is enabled, register the device approval page route. This is separate from the main
// auth routes since it serves a browser-facing HTML page, and must be on the backend's
// origin for Google session cookies to be included in requests to Better Auth.

if (auth) {
	const { devicePageHandler } = await import('./routes/device-approval.js');
	app.get('/api/device', devicePageHandler);
}

// Debug UI — only when auth is enabled AND DEBUG=true. Registered here (not in
// createApp) so it never appears in the test environment.

if (auth && DEBUG) {
	const { debugAuthHandler } = await import('./routes/debug.js');
	app.get('/api/debug/auth', debugAuthHandler);

	const debugClientId = deviceClientIds()[0];
	if (debugClientId) {
		const { createDebugDeviceHandler } = await import('./routes/device-taskpane.js');
		app.get('/api/debug/device', createDebugDeviceHandler(debugClientId));
	}

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
