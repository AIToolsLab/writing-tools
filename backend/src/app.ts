import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logSecret, openaiApiKey } from './config.js';
import { appendLog, pollLogs, validateUsername, zipLogs } from './logging.js';
import { captureException, posthogMiddleware } from './posthog.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export function createApp(): Hono {
	const app = new Hono();

	// CORS stays fully permissive for now (no backend auth yet, same as before).
	app.use('*', cors());
	app.use('*', posthogMiddleware);

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

	// Client event logging. Accepts an arbitrary JSON object; everything beyond
	// username/event/timestamp is folded into extra_data. Ports `log_from_client`.
	app.post('/api/log', async (c) => {
		const payload = (await c.req.json().catch(() => ({}))) as Record<
			string,
			unknown
		>;

		const extraData: Record<string, unknown> = {};
		if ('timestamp' in payload) {
			extraData.client_timestamp = payload.timestamp;
			delete payload.timestamp;
		}

		let username: string | null = null;
		if ('username' in payload) {
			try {
				username = validateUsername(payload.username);
				delete payload.username; // only drop it once it validated
			} catch {
				// leave the invalid username in the payload, as the old backend did
			}
		}

		const event = (payload.event as string) ?? 'unknown_event';
		delete payload.event;
		Object.assign(extraData, payload);

		// Await so we can capture write failures.
		try {
			await appendLog({
				timestamp: Date.now() / 1000,
				ok: true,
				username: username || 'unknown',
				event,
				extra_data: extraData,
			});
		} catch (e) {
			await captureException(e, { path: '/api/log' });
			return c.json({ detail: 'Failed to write log entry' }, 500);
		}

		return c.json({ message: 'Feedback logged successfully.' });
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
