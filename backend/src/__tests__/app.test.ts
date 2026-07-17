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
	it('returns an ISO timestamp and the git commit', async () => {
		const res = await app.request('/api/ping');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { timestamp: string; gitCommit: string };
		expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
		expect(body.gitCommit).toBe('unknown');
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

	it('promotes schema_version and page to top-level columns', async () => {
		const res = await app.request('/api/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'eve',
				event: 'suggestion_requested',
				schema_version: 1,
				page: 'draft',
				generationType: 'example_sentences',
			}),
		});
		expect(res.status).toBe(200);

		await new Promise((r) => setTimeout(r, 20));
		const content = await readFile(
			path.join(process.env.LOG_DIR!, 'eve.jsonl'),
			'utf8',
		);
		const entry = JSON.parse(content.trim());
		expect(entry.schema_version).toBe(1);
		expect(entry.page).toBe('draft');
		// Promoted columns must not linger in extra_data.
		expect(entry.extra_data).not.toHaveProperty('schema_version');
		expect(entry.extra_data).not.toHaveProperty('page');
		expect(entry.extra_data.generationType).toBe('example_sentences');
	});

	it('defaults schema_version to 0 and page to null for pre-schema clients', async () => {
		const res = await app.request('/api/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ username: 'eve', event: 'legacy_event' }),
		});
		expect(res.status).toBe(200);

		await new Promise((r) => setTimeout(r, 20));
		const content = await readFile(
			path.join(process.env.LOG_DIR!, 'eve.jsonl'),
			'utf8',
		);
		const entry = JSON.parse(content.trim());
		expect(entry.schema_version).toBe(0);
		expect(entry.page).toBeNull();
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
