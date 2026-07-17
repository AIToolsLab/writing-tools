import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Auth } from './auth.js'; // type-only import, no runtime cost
import { logSecret, openaiApiKey } from './config.js';
import { appendLog, pollLogs, validateUsername, zipLogs } from './logging.js';
import { captureException, posthogMiddleware } from './posthog.js';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

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

	// Feature-flagged mind-map provider transport. This remains a transparent
	// credential boundary: the frontend owns schemas and local orchestration.
	app.post('/api/openai/responses', async (c) => {
		const body = await c.req.text();
		const upstream = await fetch(OPENAI_RESPONSES_URL, {
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
				'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
			},
		});
	});

	// Mind-map study events have a deliberately narrow schema. Unlike the
	// legacy generic /api/log endpoint, this route has no place for draft,
	// message, prompt, source-span, or model-output text.
	app.post('/api/mindmap/events', async (c) => {
		const payload = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
		const kinds = new Set([
			'contract_initialized', 'contract_selected', 'contract_changed',
			'user_message', 'model_request', 'assistant_response',
			'provider_tool_requested', 'provider_tool_result',
			'pointer_validation', 'contract_decision', 'assistant_echo_overlap',
			'proposal_created', 'proposal_edited', 'proposal_resolved',
			'proposal_invalidated', 'map_mutated',
		]);
		if (!payload || typeof payload.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payload.sessionId)
			|| typeof payload.sequence !== 'number' || !Number.isFinite(payload.sequence)
			|| typeof payload.at !== 'number' || !Number.isFinite(payload.at)
			|| typeof payload.kind !== 'string' || !kinds.has(payload.kind)) {
			return c.json({ detail: 'Invalid sanitized mind-map event.' }, 400);
		}
		const optionalEnum = (name: string, values: readonly string[]) => typeof payload[name] === 'string' && values.includes(payload[name] as string) ? payload[name] : undefined;
		const optionalCode = (name: string) => typeof payload[name] === 'string' && /^[a-z0-9_:-]{1,80}$/i.test(payload[name] as string) ? payload[name] : undefined;
		const optionalNumber = (name: string) => typeof payload[name] === 'number' && Number.isFinite(payload[name]) ? payload[name] : undefined;
		try {
			await appendLog({
				timestamp: Date.now() / 1000,
				ok: true,
				username: 'mindmap',
				event: 'mindmap_event',
					extra_data: {
					session_id: payload.sessionId,
					sequence: payload.sequence,
					at: payload.at,
					kind: payload.kind,
					contract_id: optionalEnum('contractId', ['non_directive_v1', 'grounded_options_v1', 'suggestive_v1']),
					contract_level: optionalNumber('contractLevel'),
					response_kind: optionalEnum('responseKind', ['question', 'reflection', 'aside', 'map_proposal', 'options', 'suggestion']),
					origin: optionalEnum('origin', ['user_asserted', 'ai_suggested', 'unresolved', 'legacy_confirmed']),
					outcome: optionalEnum('outcome', ['accepted', 'needs_input', 'rejected', 'repaired', 'applied', 'confirmed', 'declined']),
					code: optionalCode('code'),
						duration_ms: optionalNumber('durationMs'),
						provider_transport: optionalEnum('providerTransport', ['chat_json', 'responses_tools']),
						tool_name: optionalEnum('toolName', ['propose_reflection_v1', 'propose_map_action_v1']),
						repair_count: optionalNumber('repairCount'),
				},
			});
		} catch (e) {
			await captureException(e, { path: '/api/mindmap/events' });
			return c.json({ detail: 'Failed to write mind-map event.' }, 500);
		}
		return c.json({ message: 'Mind-map event logged.' });
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
