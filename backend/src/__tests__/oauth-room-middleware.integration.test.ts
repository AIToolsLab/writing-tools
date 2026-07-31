import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getMigrations } from 'better-auth/db/migration';
import type { Auth } from '../auth.js';
import { closeDb } from '../db.js';
import { createRoom } from '../rooms.js';

const AUTH_BASE = 'http://localhost:8000/api/auth';
let auth: Auth;
let dataDir: string;

function authRequest(pathname: string, init?: RequestInit): Promise<Response> {
	return auth.handler(new Request(`${AUTH_BASE}${pathname}`, init));
}

function cookieHeader(response: Response): string {
	const headers = response.headers as Headers & { getSetCookie?: () => string[] };
	const values = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
	return values
		.filter(Boolean)
		.map((value) => value.split(';', 1)[0])
		.join('; ');
}

beforeAll(async () => {
	dataDir = mkdtempSync(path.join(tmpdir(), 'writing-tools-oauth-middleware-'));
	process.env.DATA_DIR = dataDir;
	process.env.BETTER_AUTH_SECRET = 'integration-secret-that-is-at-least-32-characters';
	process.env.BETTER_AUTH_URL = 'http://localhost:8000';
	process.env.GOOGLE_CLIENT_ID = 'test-client';
	process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
	({ auth } = await import('../auth.js'));
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
});

afterAll(() => {
	vi.useRealTimers();
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
});

describe('signed oauth_query middleware coupling', () => {
	it('populates verified state, gates client metadata, and rejects tampering or expiry', async () => {
		const registration = await authRequest('/oauth2/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				redirect_uris: ['https://mindmap.example/callback'],
				client_name: 'Integration Mindmap',
				client_uri: 'https://mindmap.example',
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code'],
				response_types: ['code'],
				scope: 'openai:chat doc:read',
				type: 'user-agent-based',
			}),
		});
		expect(registration.status).toBe(200);
		const registered = (await registration.json()) as { client_id: string };

		const signIn = await authRequest('/sign-in/anonymous', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Origin: 'http://localhost:8000',
			},
			body: '{}',
		});
		expect(signIn.status).toBe(200);
		const signedIn = (await signIn.json()) as { user: { id: string } };
		const cookie = cookieHeader(signIn);
		expect(cookie).toContain('session_token=');

		const room = createRoom(signedIn.user.id, 'Signed query draft', {
			beforeCursor: 'private', selectedText: '', afterCursor: '',
		});
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const authorize = new URL(`${AUTH_BASE}/oauth2/authorize`);
		authorize.search = new URLSearchParams({
			client_id: registered.client_id,
			redirect_uri: 'https://mindmap.example/callback',
			response_type: 'code',
			scope: 'openai:chat doc:read',
			state: `${room.id}.random-csrf`,
			code_challenge: 'a'.repeat(43),
			code_challenge_method: 'S256',
		}).toString();
		const authorization = await auth.handler(
			new Request(authorize, { headers: { Cookie: cookie } }),
		);
		expect(authorization.status).toBe(302);
		const roomPage = new URL(
			authorization.headers.get('location') ?? '',
			AUTH_BASE,
		);
		expect(roomPage.pathname).toBe('/api/oauth/room');
		const oauthQuery = roomPage.search.slice(1);
		expect(oauthQuery).toContain('sig=');

		const context = await authRequest('/oauth2/room-context', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: cookie,
				Origin: 'http://localhost:8000',
			},
			body: JSON.stringify({ oauth_query: oauthQuery }),
		});
		expect(context.status).toBe(200);
		expect(await context.json()).toMatchObject({
			room: { id: room.id, name: 'Signed query draft' },
			client: {
				id: registered.client_id,
				name: 'Integration Mindmap',
				redirect_origin: 'https://mindmap.example',
			},
			selected: false,
		});

		const tampered = new URLSearchParams(oauthQuery);
		tampered.set('state', 'room_attacker.random-csrf');
		const tamperedResponse = await authRequest('/oauth2/room-context', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ oauth_query: tampered.toString() }),
		});
		expect(tamperedResponse.status).toBe(400);

		vi.setSystemTime(new Date('2026-01-01T00:11:00Z'));
		const expired = await authRequest('/oauth2/room-context', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ oauth_query: oauthQuery }),
		});
		expect(expired.status).toBe(400);

		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const authContext = await auth.$context;
		await authContext.adapter.delete({
			model: 'oauthClient',
			where: [{ field: 'clientId', value: registered.client_id }],
		});
		const missingClient = await authRequest('/oauth2/room-context', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: cookie },
			body: JSON.stringify({ oauth_query: oauthQuery }),
		});
		expect(missingClient.status).toBe(400);
	});
});
