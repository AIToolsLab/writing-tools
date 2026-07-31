import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getMigrations } from 'better-auth/db/migration';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import type { Auth } from '../auth.js';
import { createApp } from '../app.js';
import { closeDb, db } from '../db.js';
import { provisionTrustedMindmapClient } from '../oauth-clients.js';
import { createRoom } from '../rooms.js';

const AUTH_BASE = 'http://localhost:8000/api/auth';
const CLIENT_ID = 'integration-mindmap';
const REDIRECT_URI = 'https://mindmap.example/';
let auth: Auth;
let roomConsentReferenceId: typeof import('../auth.js').roomConsentReferenceId;
let dataDir: string;

function authRequest(pathname: string, init?: RequestInit): Promise<Response> {
	return auth.handler(new Request(`${AUTH_BASE}${pathname}`, init));
}

function cookieHeader(response: Response): string {
	const headers = response.headers as Headers & { getSetCookie?: () => string[] };
	const values = headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
	return values.filter(Boolean).map((value) => value.split(';', 1)[0]).join('; ');
}

async function anonymousSession(): Promise<{ cookie: string; userId: string }> {
	const response = await authRequest('/sign-in/anonymous', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:8000' },
		body: '{}',
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { user: { id: string } };
	return { cookie: cookieHeader(response), userId: body.user.id };
}

function authorizeUrl(roomId: string, challenge: string, clientId = CLIENT_ID): URL {
	const url = new URL(`${AUTH_BASE}/oauth2/authorize`);
	url.search = new URLSearchParams({
		client_id: clientId,
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: 'openai:chat doc:read',
		resource: 'http://localhost:8000',
		state: `${roomId}.random-csrf`,
		code_challenge: challenge,
		code_challenge_method: 'S256',
	}).toString();
	return url;
}

beforeAll(async () => {
	dataDir = mkdtempSync(path.join(tmpdir(), 'writing-tools-oauth-integration-'));
	process.env.DATA_DIR = dataDir;
	process.env.BETTER_AUTH_SECRET = 'integration-secret-that-is-at-least-32-characters';
	process.env.BETTER_AUTH_URL = 'http://localhost:8000';
	process.env.GOOGLE_CLIENT_ID = 'test-client';
	process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
	process.env.MINDMAP_OAUTH_CLIENT_ID = CLIENT_ID;
	process.env.MINDMAP_OAUTH_REDIRECT_URIS = REDIRECT_URI;
	process.env.OPENAI_API_KEY = 'test-openai-key';
	process.env.OPENAI_DEMO_API_KEY = 'test-demo-openai-key';
	({ auth, roomConsentReferenceId } = await import('../auth.js'));
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
	await provisionTrustedMindmapClient(auth);
});

afterAll(() => {
	vi.unstubAllGlobals();
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
});

describe('trusted Mindmap OAuth launch', () => {
	it('idempotently provisions the configured trusted client', async () => {
		await provisionTrustedMindmapClient(auth);
		const clients = db().prepare(
			`SELECT clientId, skipConsent, requirePKCE FROM oauthClient`,
		).all();
		expect(clients).toEqual([{
			clientId: CLIENT_ID,
			skipConsent: 1,
			requirePKCE: 1,
		}]);
	});

	it('issues a real room-bound token with no consent or room screen', async () => {
		const { cookie, userId } = await anonymousSession();
		const room = createRoom(userId, 'Signed query draft', {
			beforeCursor: 'private', selectedText: '', afterCursor: '',
		});
		const other = createRoom(userId, 'Other draft', {
			beforeCursor: 'other', selectedText: '', afterCursor: '',
		});
		const verifier = 'mindmap-pkce-verifier-that-is-long-enough-for-the-test-123456';
		const challenge = createHash('sha256').update(verifier).digest('base64url');

		const authorization = await auth.handler(
			new Request(authorizeUrl(room.id, challenge), { headers: { Cookie: cookie } }),
		);
		expect(authorization.status).toBe(302);
		const callback = new URL(authorization.headers.get('location') ?? '');
		expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
		const code = callback.searchParams.get('code');
		expect(code).toBeTruthy();

		const tokenResponse = await authRequest('/oauth2/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code', client_id: CLIENT_ID,
				redirect_uri: REDIRECT_URI, code: code!, code_verifier: verifier,
				resource: 'http://localhost:8000',
			}),
		});
		expect(tokenResponse.status).toBe(200);
		const token = (await tokenResponse.json()) as {
			access_token: string; room_id: string;
		};
		expect(token.room_id).toBe(room.id);
		const payload = JSON.parse(
			Buffer.from(token.access_token.split('.')[1]!, 'base64url').toString(),
		) as Record<string, unknown>;
		expect(payload.room_id).toBe(room.id);
		const jwks = await authRequest('/jwks').then((response) => response.json()) as {
			keys: Array<Record<string, unknown>>;
		};
		expect(jwks).toMatchObject({ keys: expect.any(Array) });
		const providerVerifier = oauthProviderResourceClient(auth).getActions().verifyAccessToken;
		const verifyOAuthAccessToken = (
			accessToken: string,
			options: {
				verifyOptions: { audience: string; issuer: string };
				scopes: string[];
			},
		) => providerVerifier(accessToken, {
			...options,
			// The production verifier fetches this endpoint over HTTP. Supplying the
			// same real JWKS as a function keeps this integration test in-process.
			jwksUrl: (async () => jwks) as unknown as string,
		});

		vi.stubGlobal('fetch', vi.fn(async () =>
			new Response(JSON.stringify({
				id: 'chatcmpl_test', model: 'gpt-4o', choices: [],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}), { status: 200, headers: { 'Content-Type': 'application/json' } }),
		));
		await expect(verifyOAuthAccessToken(
			token.access_token,
			{
				verifyOptions: {
					audience: 'http://localhost:8000',
					issuer: 'http://localhost:8000/api/auth',
				},
				scopes: ['doc:read'],
			},
		)).resolves.toMatchObject({ room_id: room.id });
		const app = createApp({ auth, verifyOAuthAccessToken });
		const granted = await app.request(`/api/rooms/${room.id}`, {
			headers: { Authorization: `Bearer ${token.access_token}` },
		});
		expect(granted.status).toBe(200);
		expect(await granted.json()).toMatchObject({ id: room.id });

		const denied = await app.request(`/api/rooms/${other.id}`, {
			headers: { Authorization: `Bearer ${token.access_token}` },
		});
		expect(denied.status).toBe(403);

		const proxy = await app.request('/api/openai/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${token.access_token}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ model: 'gpt-4o', messages: [] }),
		});
		expect(proxy.status).toBe(200);
	});

	it('refuses registration, unknown clients, and rooms owned by another user', async () => {
		const registration = await authRequest('/oauth2/register', {
			method: 'POST', headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
		});
		expect(registration.status).toBe(403);

		const owner = await anonymousSession();
		const visitor = await anonymousSession();
		const room = createRoom(owner.userId, 'Owner only', {
			beforeCursor: 'private', selectedText: '', afterCursor: '',
		});
		const challenge = createHash('sha256').update('v'.repeat(64)).digest('base64url');
		const unknown = await auth.handler(new Request(
			authorizeUrl(room.id, challenge, 'unregistered-client'),
			{ headers: { Cookie: visitor.cookie } },
		));
		const unknownLocation = new URL(unknown.headers.get('location') ?? REDIRECT_URI);
		expect(unknownLocation.searchParams.get('code')).toBeNull();
		expect(unknownLocation.searchParams.get('error')).toBeTruthy();

		const foreignRoom = await auth.handler(new Request(
			authorizeUrl(room.id, challenge),
			{ headers: { Cookie: visitor.cookie } },
		));
		expect(foreignRoom.status).toBe(302);
		const foreignLocation = new URL(foreignRoom.headers.get('location') ?? '');
		expect(foreignLocation.origin + foreignLocation.pathname).toBe(REDIRECT_URI);
		expect(foreignLocation.searchParams.get('error')).toBe('access_denied');
		expect(foreignLocation.searchParams.get('error_description'))
			.toBe('The launched room does not belong to this account.');
		expect(foreignLocation.searchParams.get('state')).toBe(`${room.id}.random-csrf`);
		expect(foreignLocation.searchParams.get('code')).toBeNull();

		const missingRoomId = 'room_missing-but-well-formed';
		const missingRoom = await auth.handler(new Request(
			authorizeUrl(missingRoomId, challenge),
			{ headers: { Cookie: visitor.cookie } },
		));
		expect(missingRoom.status).toBe(302);
		const missingLocation = new URL(missingRoom.headers.get('location') ?? '');
		expect(missingLocation.origin + missingLocation.pathname).toBe(REDIRECT_URI);
		expect(missingLocation.searchParams.get('error')).toBe('access_denied');
		expect(missingLocation.searchParams.get('state'))
			.toBe(`${missingRoomId}.random-csrf`);
		expect(missingLocation.searchParams.get('code')).toBeNull();
	});

	it('fails cleanly if the consent hook is reached without a session user', async () => {
		await expect(roomConsentReferenceId({
			user: undefined,
			scopes: ['doc:read'],
		})).rejects.toMatchObject({ statusCode: 401 });
	});

	it('observes an operational client disable without a process restart', async () => {
		const { cookie, userId } = await anonymousSession();
		const room = createRoom(userId, 'Disabled client', {
			beforeCursor: '', selectedText: '', afterCursor: '',
		});
		const challenge = createHash('sha256').update('d'.repeat(64)).digest('base64url');
		db().prepare(`UPDATE oauthClient SET disabled = 1 WHERE clientId = ?`).run(CLIENT_ID);

		try {
			const authorization = await auth.handler(new Request(
				authorizeUrl(room.id, challenge),
				{ headers: { Cookie: cookie } },
			));
			expect(authorization.status).toBe(302);
			const location = new URL(authorization.headers.get('location') ?? '');
			expect(location.searchParams.get('code')).toBeNull();
			expect(location.searchParams.get('error')).toBe('client_disabled');
		} finally {
			db().prepare(`UPDATE oauthClient SET disabled = 0 WHERE clientId = ?`).run(CLIENT_ID);
		}
	});
});
