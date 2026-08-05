import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getMigrations } from 'better-auth/db/migration';
import { oauthProviderResourceClient } from '@better-auth/oauth-provider/resource-client';
import type { Auth } from '../auth.js';
import { createApp, type OAuthAccessTokenVerifier } from '../app.js';
import { closeDb, db } from '../db.js';
import { provisionTrustedMindmapClient } from '../oauth-clients.js';

const ORIGIN = 'http://localhost:8000';
const AUTH_BASE = `${ORIGIN}/api/auth`;
const ISSUER = `${AUTH_BASE}`;
const CLIENT_ID = 'integration-mindmap';
const REDIRECT_URI = 'http://localhost:5181/';

let auth: Auth;
let app: ReturnType<typeof createApp>;
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

async function anonymousSession(): Promise<{ cookie: string; userId: string }> {
	const response = await authRequest('/sign-in/anonymous', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
		body: '{}',
	});
	expect(response.status).toBe(200);
	const body = (await response.json()) as { user: { id: string } };
	return { cookie: cookieHeader(response), userId: body.user.id };
}

function authorizationUrl(challenge: string, overrides: Record<string, string> = {}): URL {
	const url = new URL(`${AUTH_BASE}/oauth2/authorize`);
	url.search = new URLSearchParams({
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: 'code',
		scope: 'openai:chat',
		resource: ORIGIN,
		state: 'integration-state',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		...overrides,
	}).toString();
	return url;
}

async function issueToken(options: { disallowed?: boolean } = {}): Promise<{
	accessToken: string;
	userId: string;
	payload: Record<string, unknown>;
}> {
	const { cookie, userId } = await anonymousSession();
	if (options.disallowed) {
		db()
			.prepare(`UPDATE user SET email = ?, isAnonymous = 0 WHERE id = ?`)
			.run('outside@example.com', userId);
	}
	const verifier = `mindmap-pkce-verifier-${crypto.randomUUID()}-long-enough`;
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	const authorization = await app.request(authorizationUrl(challenge), {
		headers: { Cookie: cookie },
	});
	expect(authorization.status).toBe(302);
	const callback = new URL(authorization.headers.get('location') ?? '');
	expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
	expect(callback.pathname).not.toContain('consent');
	const code = callback.searchParams.get('code');
	expect(code).toBeTruthy();

	const tokenResponse = await app.request(`${AUTH_BASE}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			code: code!,
			code_verifier: verifier,
			resource: ORIGIN,
		}),
	});
	expect(tokenResponse.status).toBe(200);
	const token = (await tokenResponse.json()) as {
		access_token: string;
		expires_in: number;
		token_type: string;
		scope: string;
		refresh_token?: string;
	};
	expect(token.access_token.split('.')).toHaveLength(3);
	expect(token.token_type).toBe('Bearer');
	expect(token.scope).toBe('openai:chat');
	expect(token.expires_in).toBe(60 * 60 * 12);
	expect(token.refresh_token).toBeUndefined();
	const payload = JSON.parse(
		Buffer.from(token.access_token.split('.')[1]!, 'base64url').toString(),
	) as Record<string, unknown>;
	return { accessToken: token.access_token, userId, payload };
}

async function signedToken(
	userId: string,
	overrides: Record<string, unknown>,
): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const result = await auth.api.signJWT({
		body: {
			payload: {
				sub: userId,
				azp: CLIENT_ID,
				scope: 'openai:chat',
				iss: ISSUER,
				aud: ORIGIN,
				iat: now,
				exp: now + 3600,
				...overrides,
			},
		},
	});
	return result.token;
}

beforeAll(async () => {
	dataDir = mkdtempSync(path.join(tmpdir(), 'writing-tools-oauth-standalone-'));
	process.env.DATA_DIR = dataDir;
	process.env.NODE_ENV = 'test';
	process.env.BETTER_AUTH_SECRET = 'integration-secret-that-is-at-least-32-characters';
	process.env.BETTER_AUTH_URL = ORIGIN;
	process.env.BETTER_AUTH_TRUSTED_ORIGINS = `${ORIGIN},${REDIRECT_URI}`;
	process.env.GOOGLE_CLIENT_ID = 'test-client';
	process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
	process.env.MINDMAP_OAUTH_CLIENT_ID = CLIENT_ID;
	process.env.MINDMAP_OAUTH_REDIRECT_URIS = REDIRECT_URI;
	process.env.BETTER_AUTH_DEVICE_CLIENT_IDS = 'mindmap';
	process.env.OPENAI_API_KEY = 'test-openai-key';
	process.env.OPENAI_DEMO_API_KEY = 'test-demo-openai-key';
	({ auth } = await import('../auth.js'));
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
	await provisionTrustedMindmapClient(auth);

	const jwks = (await authRequest('/jwks').then((response) => response.json())) as {
		keys: Array<Record<string, unknown>>;
	};
	const providerVerifier = oauthProviderResourceClient(auth).getActions().verifyAccessToken;
	const verifyOAuthAccessToken: OAuthAccessTokenVerifier = (token, options) =>
		providerVerifier(token, {
			...options,
			// Keep verification cryptographically real without making an HTTP request
			// back into the same in-process Hono application.
			jwksUrl: (async () => jwks) as unknown as string,
		});
	app = createApp({ auth, verifyOAuthAccessToken });
});

afterAll(() => {
	vi.unstubAllGlobals();
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
});

describe.sequential('standalone Mindmap OAuth', () => {
	it('sends an unauthenticated authorization request through the Mindmap login page', async () => {
		const challenge = createHash('sha256').update('l'.repeat(64)).digest('base64url');
		const authorization = await app.request(authorizationUrl(challenge));
		expect(authorization.status).toBe(302);
		const loginUrl = new URL(authorization.headers.get('location') ?? '', ORIGIN);
		expect(loginUrl.pathname).toBe('/api/oauth/login');
		const login = await app.request(loginUrl);
		expect(login.status).toBe(200);
		const html = await login.text();
		expect(html).toContain('Sign in with Google');
		expect(html).toContain(`searchParams.set('resource',${JSON.stringify(ORIGIN)})`);
		expect(html).not.toContain("searchParams.set('resource',location.origin)");
	});

	it('provisions idempotently without undoing an operational disable', async () => {
		await provisionTrustedMindmapClient(auth);
		const initial = db()
			.prepare(`SELECT clientId, skipConsent, requirePKCE, scopes FROM oauthClient`)
			.get() as Record<string, unknown>;
		expect(initial).toMatchObject({
			clientId: CLIENT_ID,
			skipConsent: 1,
			requirePKCE: 1,
		});
		expect(JSON.parse(initial.scopes as string)).toEqual(['openai:chat']);

		db().prepare(`UPDATE oauthClient SET disabled = 1 WHERE clientId = ?`).run(CLIENT_ID);
		await provisionTrustedMindmapClient(auth);
		const disabled = db()
			.prepare(`SELECT disabled FROM oauthClient WHERE clientId = ?`)
			.get(CLIENT_ID) as { disabled: number };
		expect(disabled.disabled).toBe(1);
		db().prepare(`UPDATE oauthClient SET disabled = 0 WHERE clientId = ?`).run(CLIENT_ID);
	});

	it('issues a real 12-hour JWT and accepts it at both text proxies', async () => {
		const { accessToken, userId, payload } = await issueToken();
		expect(payload).toMatchObject({
			sub: userId,
			iss: ISSUER,
			aud: ORIGIN,
			azp: CLIENT_ID,
			scope: 'openai:chat',
		});
		expect((payload.exp as number) - (payload.iat as number)).toBe(60 * 60 * 12);

		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				new Response(
					JSON.stringify({
						id: 'provider-test',
						model: 'gpt-4o',
						choices: [],
						usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
					}),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				),
			),
		);
		for (const endpoint of ['chat/completions', 'responses']) {
			const response = await app.request(`/api/openai/${endpoint}`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ model: 'gpt-4o' }),
			});
			expect(response.status).toBe(200);
		}
		const usage = db()
			.prepare(`SELECT DISTINCT user_id, client_id FROM llm_usage WHERE user_id = ?`)
			.all(userId);
		expect(usage).toEqual([{ user_id: userId, client_id: CLIENT_ID }]);
	});

	it('requires the byte-exact resource on authorize and token requests', async () => {
		const missingAuthorize = authorizationUrl('challenge', { resource: '' });
		missingAuthorize.searchParams.delete('resource');
		expect((await app.request(missingAuthorize)).status).toBe(400);
		expect(
			(await app.request(authorizationUrl('challenge', { resource: `${ORIGIN}/` }))).status,
		).toBe(400);

		for (const resource of [undefined, `${ORIGIN}/`]) {
			const body = new URLSearchParams({ grant_type: 'authorization_code' });
			if (resource) body.set('resource', resource);
			const response = await app.request(`${AUTH_BASE}/oauth2/token`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body,
			});
			expect(response.status).toBe(400);
			expect(await response.json()).toMatchObject({ error: 'invalid_target' });
		}
	});

	it('rejects invalid OAuth credentials without falling through to demo access', async () => {
		const { userId } = await anonymousSession();
		const now = Math.floor(Date.now() / 1000);
		const tokens = [
			'not-a-jwt',
			await signedToken(userId, { aud: 'https://wrong.example' }),
			await signedToken(userId, { scope: 'something:else' }),
			await signedToken(userId, { iat: now - 120, exp: now - 60 }),
		];
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		for (const token of tokens) {
			const response = await app.request('/api/openai/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ model: 'gpt-4o' }),
			});
			expect(response.status).toBe(401);
			expect(response.headers.get('X-Writing-Tools-Error')).toBe('platform-auth');
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('allows login but forbids a user outside the beta allowlist at the proxy', async () => {
		const { accessToken } = await issueToken({ disallowed: true });
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		const response = await app.request('/api/openai/chat/completions', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ model: 'gpt-4o' }),
		});
		expect(response.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('does not accept openai:chat OAuth tokens on non-proxy routes', async () => {
		const { accessToken } = await issueToken();
		const headers = {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json',
		};
		expect(
			await auth.api.getSession({ headers: new Headers(headers) }),
		).toBeNull();
		const requests: Array<[string, RequestInit]> = [
			['/api/openai/realtime/session', { method: 'POST', headers, body: '{}' }],
			['/api/log', { method: 'POST', headers, body: '{}' }],
			[
				'/api/me/consent',
				{ method: 'POST', headers, body: JSON.stringify({ loggingConsent: 'usage' }) },
			],
			['/api/me/activity', { method: 'DELETE', headers }],
			[
				'/api/handoff',
				{
					method: 'POST',
					headers,
					body: JSON.stringify({
						tool_client_id: 'mindmap',
						scopes: ['openai:chat'],
					}),
				},
			],
		];
		for (const [url, init] of requests) {
			expect((await app.request(url, init)).status, url).toBe(401);
		}

		const { cookie } = await anonymousSession();
		const handoffWithCookie = await app.request('/api/handoff', {
			method: 'POST',
			headers: { ...headers, Cookie: cookie },
			body: JSON.stringify({
				tool_client_id: 'mindmap',
				scopes: ['openai:chat'],
			}),
		});
		expect(handoffWithCookie.status).toBe(401);
		const malformedBearerWithCookie = await app.request('/api/handoff', {
			method: 'POST',
			headers: {
				...headers,
				Authorization: 'Bearer malformed-oauth-credential',
				Cookie: cookie,
			},
			body: JSON.stringify({
				tool_client_id: 'mindmap',
				scopes: ['openai:chat'],
			}),
		});
		expect(malformedBearerWithCookie.status).toBe(401);
	});

	it('refuses missing PKCE, wrong redirects, unknown clients, and registration', async () => {
		const { cookie } = await anonymousSession();
		const missingPkce = authorizationUrl('unused');
		missingPkce.searchParams.delete('code_challenge');
		missingPkce.searchParams.delete('code_challenge_method');
		const missingPkceResponse = await app.request(missingPkce, {
			headers: { Cookie: cookie },
		});
		expect(new URL(missingPkceResponse.headers.get('location') ?? REDIRECT_URI).searchParams.get('error')).toBe(
			'invalid_request',
		);

		const invalidClients: Array<Record<string, string>> = [
			{ redirect_uri: 'https://mindmap.thoughtful-ai.com/' },
			{ client_id: 'unregistered-client' },
		];
		for (const overrides of invalidClients) {
			const response = await app.request(authorizationUrl('challenge', overrides), {
				headers: { Cookie: cookie },
			});
			expect(response.status).not.toBe(200);
			const location = response.headers.get('location');
			if (location) expect(new URL(location).searchParams.get('code')).toBeNull();
		}

		const registration = await app.request(`${AUTH_BASE}/oauth2/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
		});
		expect(registration.status).toBe(403);
	});

	it('does not register or accept localhost in the production client configuration', async () => {
		process.env.NODE_ENV = 'production';
		process.env.MINDMAP_OAUTH_REDIRECT_URIS =
			'https://mindmap.thoughtful-ai.com/';
		try {
			await provisionTrustedMindmapClient(auth);
			const row = db()
				.prepare(`SELECT redirectUris FROM oauthClient WHERE clientId = ?`)
				.get(CLIENT_ID) as { redirectUris: string };
			expect(JSON.parse(row.redirectUris)).toEqual([
				'https://mindmap.thoughtful-ai.com/',
			]);
			const { cookie } = await anonymousSession();
			const response = await app.request(authorizationUrl('challenge'), {
				headers: { Cookie: cookie },
			});
			const location = response.headers.get('location');
			if (location) expect(new URL(location, ORIGIN).searchParams.get('code')).toBeNull();
			expect(response.status).not.toBe(200);
		} finally {
			process.env.NODE_ENV = 'test';
			process.env.MINDMAP_OAUTH_REDIRECT_URIS = REDIRECT_URI;
			await provisionTrustedMindmapClient(auth);
		}
	});
});
