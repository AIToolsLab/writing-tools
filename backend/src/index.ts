import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { openaiApiKey, PORT } from './config.js';
import { shutdownPosthog } from './posthog.js';

if (!openaiApiKey()) {
	console.warn('OPENAI_API_KEY is not set; /api/openai/* requests will fail.');
}

const server = serve(
	{ fetch: createApp().fetch, port: PORT, hostname: '0.0.0.0' },
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
