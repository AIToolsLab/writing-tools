import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { Auth } from '../auth.js';
import { closeDb, db } from '../db.js';
import { PLATFORM_AUTH_ERROR_HEADER } from '../openaiProxy.js';

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
	vi.unstubAllGlobals();
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

/** Where the tool is launched, and the origin a grant for it is therefore bound to. */
const TOOL_URL = 'https://tool.example/app/?x=1';
const TOOL_ORIGIN = 'https://tool.example';

function post(
	app: ReturnType<typeof createApp>,
	url: string,
	body: unknown,
	token?: string,
	origin?: string,
) {
	return app.request(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(token ? { Authorization: `Bearer ${token}` } : {}),
			...(origin ? { Origin: origin } : {}),
		},
		body: JSON.stringify(body),
	});
}

/** Mint a grant as the signed-in taskpane would. */
async function mintGrant(
	body: Record<string, unknown> = {},
): Promise<{ grant_id: string }> {
	const res = await post(authApp(SIGNED_IN), '/api/handoff', {
		tool_client_id: 'mindmap',
		tool_url: TOOL_URL,
		...body,
	});
	return (await res.json()) as { grant_id: string };
}

/**
 * Redeem a grant the way the launched tool's browser page does: with an Origin.
 * `null` stands for "send no Origin header at all".
 */
function exchange(grantId: string, origin: string | null = TOOL_ORIGIN) {
	return post(
		createApp(),
		'/api/handoff/exchange',
		{ grant_id: grantId },
		undefined,
		origin ?? undefined,
	);
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
			tool_url: TOOL_URL,
		});
		expect(res.status).toBe(400);
	});

	it('rejects invalid scopes', async () => {
		const res = await post(authApp(SIGNED_IN), '/api/handoff', {
			tool_client_id: 'mindmap',
			tool_url: TOOL_URL,
			scopes: ['openai:chat', 'root:everything'],
		});
		expect(res.status).toBe(400);
	});

	it.each([undefined, 'not a url', 'javascript:alert(1)', 'file:///etc/passwd'])(
		'rejects a launch url of %p — there would be no origin to bind the grant to',
		async (toolUrl) => {
			const res = await post(authApp(SIGNED_IN), '/api/handoff', {
				tool_client_id: 'mindmap',
				tool_url: toolUrl,
			});
			expect(res.status).toBe(400);
		},
	);

	it('mints a grant for a signed-in user', async () => {
		const res = await post(authApp(SIGNED_IN), '/api/handoff', {
			tool_client_id: 'mindmap',
			tool_url: TOOL_URL,
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { grant_id: string; expires_in: number };
		expect(body.grant_id).toMatch(/^wtg_/);
		expect(body.expires_in).toBeGreaterThan(0);
	});
});

describe('POST /api/handoff/exchange', () => {
	it('swaps a grant for a token + doc snapshot, and is single-use', async () => {
		const created = await mintGrant({
			doc: { beforeCursor: 'hi', selectedText: '', afterCursor: '' },
		});

		// Exchange needs no session — the grant_id is the credential.
		const res = await exchange(created.grant_id);
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
		expect((await exchange(created.grant_id)).status).toBe(400);
	});

	it('400s a missing grant_id', async () => {
		const res = await post(createApp(), '/api/handoff/exchange', {});
		expect(res.status).toBe(400);
	});

	// The grant is bound to the origin the taskpane launched, so a grant that leaks
	// (or is relayed into an attacker's page) can't be redeemed anywhere else.
	it.each([
		['a different origin', 'https://evil.example'],
		['a sibling host', 'https://tool.example.evil.test'],
		['a scheme downgrade', 'http://tool.example'],
		['a non-default port', 'https://tool.example:8443'],
		['no Origin at all', null],
	])('refuses an exchange from %s', async (_label, origin) => {
		const created = await mintGrant();

		const res = await exchange(created.grant_id, origin);
		expect(res.status).toBe(400);
		expect((await res.json()) as { error: string }).toMatchObject({
			error: 'origin_mismatch',
		});

		// A refused attempt must not burn the grant — the real tool still redeems it.
		expect((await exchange(created.grant_id)).status).toBe(200);
	});
});

describe('tool token end-to-end', () => {
	async function tokenFor(scopes?: string[]): Promise<string> {
		const created = await mintGrant({
			scopes,
			doc: { beforeCursor: 'doc', selectedText: '', afterCursor: '' },
		});
		const ex = (await (await exchange(created.grant_id)).json()) as {
			access_token: string;
		};
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

	it.each(['revoked', 'expired'] as const)(
		'fails a %s tool token closed at the proxy even with demo access',
		async (state) => {
			vi.stubEnv('OPENAI_DEMO_API_KEY', 'demo-key');
			const token = await tokenFor(['openai:chat']);
			if (state === 'revoked') {
				await post(createApp(), '/api/handoff/revoke', {}, token);
			} else {
				db()
					.prepare(
						'UPDATE tool_grant SET token_expires_at = ? WHERE access_token = ?',
					)
					.run(Date.now() - 1, token);
			}
			const fetchMock = vi.fn();
			vi.stubGlobal('fetch', fetchMock);
			const res = await post(
				createApp(),
				'/api/openai/chat/completions',
				{ model: 'gpt-4o' },
				token,
			);
			expect(res.status).toBe(401);
			expect(res.headers.get(PLATFORM_AUTH_ERROR_HEADER)).toBe('platform-auth');
			expect(fetchMock).not.toHaveBeenCalled();
		},
	);
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
