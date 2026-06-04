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

async function shutdown(): Promise<void> {
	await shutdownPosthog();
	server.close();
	process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
