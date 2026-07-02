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
import type { Auth } from '../auth.js';

const app = createApp();
const env = { ...process.env };

/**
 * Minimal Better Auth stub: getSession returns the given user (or null), and
 * updateUser/deleteUser record their calls. Cast to Auth — we only touch the
 * surface the app handlers use.
 */
function makeAuthApp(user: { id: string; loggingConsent?: string } | null) {
	const calls: { updateUser: unknown[]; deleteUser: unknown[] } = {
		updateUser: [],
		deleteUser: [],
	};
	const auth = {
		handler: async () => new Response(null),
		api: {
			getSession: async () => (user ? { user } : null),
			updateUser: async (args: unknown) => {
				calls.updateUser.push(args);
				return { status: true };
			},
			deleteUser: async (args: unknown) => {
				calls.deleteUser.push(args);
				return { success: true, message: 'ok' };
			},
		},
	} as unknown as Auth;
	return { app: createApp({ auth }), calls };
}

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

async function readUserLog(userId: string) {
	const content = await readFile(
		path.join(process.env.LOG_DIR as string, `${userId}.jsonl`),
		'utf8',
	);
	return JSON.parse(content.trim());
}

describe('POST /api/log', () => {
	it('rejects unauthenticated requests with 401', async () => {
		const { app: authApp } = makeAuthApp(null);
		const res = await authApp.request('/api/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ event: 'saved' }),
		});
		expect(res.status).toBe(401);
	});

	it('keys the log by the session user id and ignores any client username', async () => {
		const { app: authApp } = makeAuthApp({
			id: 'user-123',
			loggingConsent: 'document',
		});
		const res = await authApp.request('/api/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				username: 'spoofed',
				event: 'saved',
				timestamp: 123,
				detail: 'hello',
			}),
		});
		expect(res.status).toBe(200);
		const entry = await readUserLog('user-123');
		expect(entry.username).toBe('user-123');
		expect(entry.event).toBe('saved');
		expect(entry.extra_data.client_timestamp).toBe(123);
		expect(entry.extra_data.detail).toBe('hello');
		expect(entry.extra_data.username).toBeUndefined();
	});

	it("strips content above the user's consent level ('usage')", async () => {
		const { app: authApp } = makeAuthApp({
			id: 'usr-usage',
			loggingConsent: 'usage',
		});
		await authApp.request('/api/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				event: 'ShowSuggestion',
				generation_type: 'example_sentences',
				prompt: { beforeCursor: 'secret doc' },
				result: { result: 'AI text' },
			}),
		});
		const entry = await readUserLog('usr-usage');
		expect(entry.extra_data.generation_type).toBe('example_sentences');
		expect(entry.extra_data.prompt).toBeUndefined();
		expect(entry.extra_data.result).toBeUndefined();
	});

	it("logs nothing at level 'none' but still returns 200", async () => {
		const { app: authApp } = makeAuthApp({
			id: 'usr-none',
			loggingConsent: 'none',
		});
		const res = await authApp.request('/api/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ event: 'ShowSuggestion' }),
		});
		expect(res.status).toBe(200);
		await expect(readUserLog('usr-none')).rejects.toThrow(); // no file written
	});
});

describe('POST /api/me/consent', () => {
	it('rejects an invalid level and accepts a valid one via updateUser', async () => {
		const { app: authApp, calls } = makeAuthApp({
			id: 'usr-1',
			loggingConsent: 'usage',
		});

		const bad = await authApp.request('/api/me/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ level: 'everything' }),
		});
		expect(bad.status).toBe(400);

		const good = await authApp.request('/api/me/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ level: 'ai_output' }),
		});
		expect(good.status).toBe(200);
		expect(await good.json()).toEqual({ loggingConsent: 'ai_output' });
		expect(calls.updateUser).toHaveLength(1);
	});

	it('401s without a session', async () => {
		const { app: authApp } = makeAuthApp(null);
		const res = await authApp.request('/api/me/consent', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ level: 'usage' }),
		});
		expect(res.status).toBe(401);
	});
});

describe('DELETE /api/me/data', () => {
	it("deletes the authenticated user's log file", async () => {
		const { app: authApp } = makeAuthApp({
			id: 'usr-del',
			loggingConsent: 'document',
		});
		// Write a log entry, confirm it exists, then delete.
		await authApp.request('/api/log', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ event: 'saved' }),
		});
		await readUserLog('usr-del'); // throws if missing

		const res = await authApp.request('/api/me/data', { method: 'DELETE' });
		expect(res.status).toBe(200);
		await expect(readUserLog('usr-del')).rejects.toThrow();
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
