import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Auth } from '../auth.js';
import { closeDb } from '../db.js';

const env = { ...process.env };

beforeEach(async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'wt-handoff-'));
	process.env.DATA_DIR = dir;
	vi.stubEnv('LOG_DIR', path.join(dir, 'logs'));
	// The tool launcher reuses the device-client allowlist to decide who may
	// receive a grant.
	vi.stubEnv('BETTER_AUTH_DEVICE_CLIENT_IDS', 'mindmap,writing-tools-editor');
});

afterEach(() => {
	vi.unstubAllEnvs();
	closeDb();
	process.env = { ...env };
});

/** App wired to a Better Auth stub whose session is `user` (or null). */
function authApp(user: { id: string; email?: string; loggingConsent?: string } | null) {
	const auth = {
		handler: async () => new Response(null),
		api: { getSession: async () => (user ? { user } : null) },
	} as unknown as Auth;
	return createApp({ auth });
}

const SIGNED_IN = { id: 'usr-1', email: 'a@calvin.edu', loggingConsent: 'usage' };

function post(app: ReturnType<typeof createApp>, url: string, body: unknown, token?: string) {
	return app.request(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	});
}

describe('POST /api/handoff', () => {
	it('rejects an unauthenticated request', async () => {
		const res = await post(authApp(null), '/api/handoff', {
			tool_client_id: 'mindmap',
		});
		expect(res.status).toBe(401);
	});

	it('rejects a tool_client_id outside the allowlist', async () => {
		const res = await post(authApp(SIGNED_IN), '/api/handoff', {
			tool_client_id: 'not-registered',
		});
		expect(res.status).toBe(400);
	});

	it('rejects invalid scopes', async () => {
		const res = await post(authApp(SIGNED_IN), '/api/handoff', {
			tool_client_id: 'mindmap',
			scopes: ['openai:chat', 'root:everything'],
		});
		expect(res.status).toBe(400);
	});

	it('mints a grant for a signed-in user', async () => {
		const res = await post(authApp(SIGNED_IN), '/api/handoff', {
			tool_client_id: 'mindmap',
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { grant_id: string; expires_in: number };
		expect(body.grant_id).toMatch(/^wtg_/);
		expect(body.expires_in).toBeGreaterThan(0);
	});
});

describe('POST /api/handoff/exchange', () => {
	it('swaps a grant for a token + doc snapshot, and is single-use', async () => {
		const app = authApp(SIGNED_IN);
		const created = (await (
			await post(app, '/api/handoff', {
				tool_client_id: 'mindmap',
				doc: { beforeCursor: 'hi', selectedText: '', afterCursor: '' },
			})
		).json()) as { grant_id: string };

		// Exchange needs no session — the grant_id is the credential.
		const res = await post(createApp(), '/api/handoff/exchange', {
			grant_id: created.grant_id,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			access_token: string;
			client_id: string;
			scopes: string[];
			doc: unknown;
		};
		expect(body.access_token).toMatch(/^wtk_/);
		expect(body.client_id).toBe('mindmap');
		expect(body.doc).toEqual({ beforeCursor: 'hi', selectedText: '', afterCursor: '' });

		// Replaying the grant fails.
		const replay = await post(createApp(), '/api/handoff/exchange', {
			grant_id: created.grant_id,
		});
		expect(replay.status).toBe(400);
	});

	it('400s a missing grant_id', async () => {
		const res = await post(createApp(), '/api/handoff/exchange', {});
		expect(res.status).toBe(400);
	});
});

describe('tool token end-to-end', () => {
	async function tokenFor(scopes?: string[]): Promise<string> {
		const app = authApp(SIGNED_IN);
		const created = (await (
			await post(app, '/api/handoff', {
				tool_client_id: 'mindmap',
				scopes,
				doc: { beforeCursor: 'doc', selectedText: '', afterCursor: '' },
			})
		).json()) as { grant_id: string };
		const ex = (await (
			await post(createApp(), '/api/handoff/exchange', { grant_id: created.grant_id })
		).json()) as { access_token: string };
		return ex.access_token;
	}

	it('authenticates /api/log and stamps the tool client_id on the entry', async () => {
		const token = await tokenFor();
		// The wtk_ token authenticates without any Better Auth session present.
		const res = await post(createApp(), '/api/log', { event: 'tool_event' }, token);
		expect(res.status).toBe(200);

		const content = await readFile(
			path.join(process.env.LOG_DIR as string, 'usr-1.jsonl'),
			'utf8',
		);
		const entry = JSON.parse(content.trim());
		expect(entry.username).toBe('usr-1');
		expect(entry.event).toBe('tool_event');
		expect(entry.client_id).toBe('mindmap');
	});

	it('re-fetches the doc snapshot when doc:read is granted', async () => {
		const token = await tokenFor(['openai:chat', 'doc:read']);
		const res = await createApp().request('/api/handoff/doc', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		expect((await res.json()) as { doc: unknown }).toEqual({
			doc: { beforeCursor: 'doc', selectedText: '', afterCursor: '' },
		});
	});

	it('forbids the doc re-fetch without the doc:read scope', async () => {
		const token = await tokenFor(['openai:chat']);
		const res = await createApp().request('/api/handoff/doc', {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(403);
	});

	it('revokes a token so it can no longer authenticate', async () => {
		const token = await tokenFor();
		expect((await post(createApp(), '/api/handoff/revoke', {}, token)).status).toBe(200);

		const res = await post(createApp(), '/api/log', { event: 'after_revoke' }, token);
		expect(res.status).toBe(401);
	});
});

describe('X-Client-Id header attribution (device-flow tools)', () => {
	async function logWithClient(header: string | undefined): Promise<unknown> {
		const app = authApp(SIGNED_IN);
		await app.request('/api/log', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(header ? { 'X-Client-Id': header } : {}),
			},
			body: JSON.stringify({ event: 'e' }),
		});
		const content = await readFile(
			path.join(process.env.LOG_DIR as string, 'usr-1.jsonl'),
			'utf8',
		);
		return JSON.parse(content.trim()).client_id;
	}

	it('stamps an allowlisted client id', async () => {
		expect(await logWithClient('writing-tools-editor')).toBe('writing-tools-editor');
	});

	it('ignores a client id outside the allowlist (attribution can\'t be spoofed)', async () => {
		expect(await logWithClient('evil-tool')).toBeNull();
	});

	it('defaults to null (the first-party add-in) with no header', async () => {
		expect(await logWithClient(undefined)).toBeNull();
	});
});
