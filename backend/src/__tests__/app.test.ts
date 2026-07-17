import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { createApp } from '../app.js';

const app = createApp();
const env = { ...process.env };

beforeEach(async () => {
	process.env.LOG_DIR = await mkdtemp(path.join(tmpdir(), 'wt-app-'));
});

afterEach(() => {
	process.env = { ...env };
	vi.restoreAllMocks();
});

describe('GET /api/ping', () => {
	it('returns an ISO timestamp', async () => {
		const res = await app.request('/api/ping');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { timestamp: string };
		expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
	});
});

describe('POST /api/log', () => {
	it('writes the event and folds extras into extra_data', async () => {
		const res = await app.request('/api/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'eve',
				event: 'saved',
				timestamp: 123,
				detail: 'hello',
			}),
		});
		expect(res.status).toBe(200);

		// allow the fire-and-forget append to flush
		await new Promise((r) => setTimeout(r, 20));
		const content = await readFile(
			path.join(process.env.LOG_DIR!, 'eve.jsonl'),
			'utf8',
		);
		const entry = JSON.parse(content.trim());
		expect(entry.username).toBe('eve');
		expect(entry.event).toBe('saved');
		expect(entry.extra_data.client_timestamp).toBe(123);
		expect(entry.extra_data.detail).toBe('hello');
	});
});

describe('POST /api/openai/chat/completions', () => {
	it('injects the API key and forwards the body', async () => {
		process.env.OPENAI_API_KEY = 'sk-test-123';
		const fetchMock = vi
			.fn()
			.mockResolvedValue(new Response('data: ok\n\n', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const res = await app.request('/api/openai/chat/completions', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
		});

		expect(res.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toContain('api.openai.com');
		expect((init.headers as Record<string, string>).Authorization).toBe(
			'Bearer sk-test-123',
		);
		expect(init.body).toContain('gpt-4o');
	});
});

describe('POST /api/openai/responses', () => {
	it('injects the API key and forwards Responses API requests unchanged', async () => {
		process.env.OPENAI_API_KEY = 'sk-test-123';
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'resp_1', output: [] }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}));
		vi.stubGlobal('fetch', fetchMock);

		const body = { model: 'gpt-5.6-terra', input: [], tools: [{ type: 'function', name: 'propose_map_action_v1' }] };
		const res = await app.request('/api/openai/responses', {
			method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
		});

		expect(res.status).toBe(200);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('https://api.openai.com/v1/responses');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-123');
		expect(JSON.parse(init.body as string)).toEqual(body);
	});
});

describe('POST /api/mindmap/events', () => {
	it('accepts only the sanitized event shape and never persists arbitrary content', async () => {
		const accepted = await app.request('/api/mindmap/events', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId: 's1', sequence: 1, at: 123, kind: 'proposal_created', contractId: 'non_directive_v1', contractLevel: 0, origin: 'user_asserted', text: 'must not persist' }),
		});
		expect(accepted.status).toBe(200);
		const content = await readFile(path.join(process.env.LOG_DIR!, 'mindmap.jsonl'), 'utf8');
		expect(content).toContain('proposal_created');
		expect(content).not.toContain('must not persist');

		const rejected = await app.request('/api/mindmap/events', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId: 's1', sequence: 2, at: 124, kind: 'not_allowed' }),
		});
		expect(rejected.status).toBe(400);

		const textBearingSessionId = await app.request('/api/mindmap/events', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId: 'private draft wording', sequence: 3, at: 125, kind: 'proposal_created' }),
		});
		expect(textBearingSessionId.status).toBe(400);

		const toolEvent = await app.request('/api/mindmap/events', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ sessionId: 's1', sequence: 4, at: 126, kind: 'provider_tool_requested', providerTransport: 'responses_tools', toolName: 'propose_map_action_v1', repairCount: 0, arguments: 'private words' }),
		});
		expect(toolEvent.status).toBe(200);
		const toolContent = await readFile(path.join(process.env.LOG_DIR!, 'mindmap.jsonl'), 'utf8');
		expect(toolContent).toContain('propose_map_action_v1');
		expect(toolContent).not.toContain('private words');
	});
});

describe('log-viewer secret gate', () => {
	it('rejects logs_poll with a wrong secret and accepts the right one', async () => {
		process.env.LOG_SECRET = 'super-secret';

		const bad = await app.request('/api/logs_poll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ log_positions: {}, secret: 'nope' }),
		});
		expect(bad.status).toBe(403);

		const good = await app.request('/api/logs_poll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ log_positions: {}, secret: 'super-secret' }),
		});
		expect(good.status).toBe(200);
		expect(await good.json()).toEqual([]);
	});

	it('returns 500 when LOG_SECRET is unset', async () => {
		delete process.env.LOG_SECRET;
		const res = await app.request('/api/download_logs');
		expect(res.status).toBe(500);
	});
});
