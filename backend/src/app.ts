import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Auth } from './auth.js'; // type-only import, no runtime cost
import { logSecret, openaiApiKey } from './config.js';
import { appendLog, pollLogs, validateUsername, zipLogs } from './logging.js';
import { captureException, posthogMiddleware } from './posthog.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

export function createApp({ auth }: { auth?: Auth } = {}): Hono {
	const app = new Hono();

	// CORS stays fully permissive for now to preserve existing behaviour.
	app.use('*', cors());
	app.use('*', posthogMiddleware);

	if (auth) {
		// Better Auth owns all /api/auth/* — OAuth redirects, callbacks, sessions, sign-out
		app.on(['POST', 'GET'], '/api/auth/*', (c) => auth.handler(c.req.raw));

		// Permanent diagnostic route — proves cookie + Bearer session verification works
		app.get('/api/protected', async (c) => {
			const session = await auth.api.getSession({ headers: c.req.raw.headers });
			if (!session) return c.json({ error: 'Unauthorized' }, 401);
			return c.json({ email: session.user.email, name: session.user.name });
		});
	}

	app.onError(async (err, c) => {
		await captureException(err, { path: c.req.path, method: c.req.method });
		return c.json({ detail: 'Internal server error' }, 500);
	});

	// OpenAI-compatible passthrough. The frontend's ai-sdk client posts here; we
	// only inject the server-held API key and relay the upstream response back.
	// We log every request/response so empty or truncated replies are visible
	// instead of silently surfacing as a 200 with no body.
	app.post('/api/openai/chat/completions', async (c) => {
		const body = await c.req.text();
		// Non-streaming requests (e.g. the my-words generateText path) omit
		// `stream:true`; those we buffer fully so a dropped upstream connection
		// throws here rather than yielding an empty 200. Streaming requests
		// (streamText pages) are relayed through with a byte counter.
		const wantsStream = (() => {
			try {
				return Boolean((JSON.parse(body) as { stream?: unknown }).stream);
			} catch {
				return false;
			}
		})();

		const started = Date.now();
		let upstream: Response;
		try {
			upstream = await fetch(OPENAI_URL, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${openaiApiKey()}`,
					'Content-Type': 'application/json',
				},
				body,
			});
		} catch (e) {
			console.error('[openai-proxy] upstream fetch failed:', (e as Error).message);
			throw e; // -> onError -> 500 JSON, instead of a silent empty response
		}

		const contentType =
			upstream.headers.get('content-type') ??
			(wantsStream ? 'text/event-stream' : 'application/json');

		const log = (bytes: number) => {
			const line = `[openai-proxy] ${upstream.status} ${
				wantsStream ? 'stream' : 'json'
			} ${contentType.split(';')[0]} ${bytes}B ${Date.now() - started}ms`;
			if (!upstream.ok || bytes === 0) console.warn(`${line} ⚠️ EMPTY/ERROR`);
			else console.log(line);
		};

		if (!wantsStream) {
			let buf: ArrayBuffer;
			try {
				buf = await upstream.arrayBuffer();
			} catch (e) {
				console.error(
					'[openai-proxy] upstream body read failed:',
					(e as Error).message,
				);
				throw e;
			}
			log(buf.byteLength);
			return new Response(buf, {
				status: upstream.status,
				headers: { 'Content-Type': contentType },
			});
		}

		// Streaming: relay the body through a pass-through that tallies bytes so
		// we can log the total (and flag an empty stream) once it completes.
		let bytes = 0;
		const counter = new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, ctrl) {
				bytes += chunk.byteLength;
				ctrl.enqueue(chunk);
			},
			flush() {
				log(bytes);
			},
		});

		return new Response(upstream.body?.pipeThrough(counter) ?? null, {
			status: upstream.status,
			headers: { 'Content-Type': contentType },
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
