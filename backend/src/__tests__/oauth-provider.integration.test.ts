import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getMigrations } from 'better-auth/db/migration';
import type { Auth } from '../auth.js';
import { createApp } from '../app.js';
import { closeDb, db } from '../db.js';
import { provisionTrustedOAuthClients } from '../oauth-clients.js';

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

/** Runs authorize as a signed-in user and returns the code and its PKCE verifier. */
async function authorizeCode(cookie: string): Promise<{ code: string; verifier: string }> {
	const verifier = `mindmap-pkce-verifier-${crypto.randomUUID()}-long-enough`;
	const challenge = createHash('sha256').update(verifier).digest('base64url');
	const authorization = await app.request(authorizationUrl(challenge), {
		headers: { Cookie: cookie },
	});
	expect(authorization.status).toBe(302);
	const callback = new URL(authorization.headers.get('location') ?? '');
	expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
	const code = callback.searchParams.get('code');
	expect(code).toBeTruthy();
	return { code: code!, verifier };
}

/** The token request. `resource` is sent only when given, as Mindmap may omit it. */
async function exchangeCode(code: string, verifier: string, resource?: string): Promise<Response> {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		code,
		code_verifier: verifier,
	});
	if (resource !== undefined) body.set('resource', resource);
	return app.request(`${AUTH_BASE}/oauth2/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body,
	});
}

async function issueToken(): Promise<{
	accessToken: string;
	userId: string;
	payload: Record<string, unknown>;
}> {
	const { cookie, userId } = await anonymousSession();
	const { code, verifier } = await authorizeCode(cookie);
	const tokenResponse = await exchangeCode(code, verifier);
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

beforeAll(async () => {
	dataDir =mkdtempSync(path.join(tmpdir(), 'writing-tools-oauth-provider-'));
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
	await provisionTrustedOAuthClients(auth);
	app = createApp({ auth });
});

afterAll(() => {
	vi.unstubAllGlobals();
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
});

describe.sequential('OAuth provider (Mindmap client)', () => {
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
		expect(html).toContain('oauth_query');
		// The resource is part of the signed continuation, not re-added by the page.
		expect(loginUrl.searchParams.get('resource')).toBe(ORIGIN);
		expect(loginUrl.searchParams.getAll('ba_param')).toContain('resource');
	});

	it('resumes authorization from the login page once sign-in sets a session', async () => {
		// The provider's continuation fires on any sign-in that sets a session cookie,
		// so anonymous sign-in stands in for the Google callback here.
		const verifier = `mindmap-pkce-verifier-${crypto.randomUUID()}-long-enough`;
		const challenge = createHash('sha256').update(verifier).digest('base64url');
		const authorization = await app.request(authorizationUrl(challenge));
		const loginUrl = new URL(authorization.headers.get('location') ?? '', ORIGIN);

		const signIn = await authRequest('/sign-in/anonymous', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
			body: JSON.stringify({ oauth_query: loginUrl.search.slice(1) }),
		});
		expect(signIn.status).toBe(200);
		const { url } = (await signIn.json()) as { url: string };
		const callback = new URL(url);
		expect(callback.origin + callback.pathname).toBe(REDIRECT_URI);
		const code = callback.searchParams.get('code');
		expect(code).toBeTruthy();

		const token = await app.request(`${AUTH_BASE}/oauth2/token`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				client_id: CLIENT_ID,
				redirect_uri: REDIRECT_URI,
				code: code!,
				code_verifier: verifier,
			}),
		});
		expect(token.status).toBe(200);
		const { access_token } = (await token.json()) as { access_token: string };
		const payload = JSON.parse(
			Buffer.from(access_token.split('.')[1]!, 'base64url').toString(),
		) as Record<string, unknown>;
		expect(payload.aud).toBe(ORIGIN);
	});

	it('provisions idempotently without undoing an operational disable', async () => {
		await provisionTrustedOAuthClients(auth);
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
		await provisionTrustedOAuthClients(auth);
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

	it('requires the byte-exact resource on authorize', async () => {
		const missingAuthorize = authorizationUrl('challenge', { resource: '' });
		missingAuthorize.searchParams.delete('resource');
		expect((await app.request(missingAuthorize)).status).toBe(400);
		expect(
			(await app.request(authorizationUrl('challenge', { resource: `${ORIGIN}/` }))).status,
		).toBe(400);
	});

	it('binds the code to the authorized resource at the token endpoint', async () => {
		// Omitted: the token inherits the resource approved at authorize.
		expect((await issueToken()).payload.aud).toBe(ORIGIN);

		const { cookie } = await anonymousSession();
		const same = await authorizeCode(cookie);
		expect((await exchangeCode(same.code, same.verifier, ORIGIN)).status).toBe(200);

		// Anything else, even a near-miss of the origin, is refused.
		const nearMiss = await authorizeCode(cookie);
		const refused = await exchangeCode(nearMiss.code, nearMiss.verifier, `${ORIGIN}/`);
		expect(refused.status).toBe(400);
		expect(await refused.json()).toMatchObject({ error: 'invalid_target' });
	});

	it('clears a stale secret when re-provisioning an existing client row', async () => {
		db()
			.prepare(`UPDATE oauthClient SET clientSecret = ? WHERE clientId = ?`)
			.run('stale-confidential-secret', CLIENT_ID);
		await provisionTrustedOAuthClients(auth);
		const row = db()
			.prepare(`SELECT clientSecret FROM oauthClient WHERE clientId = ?`)
			.get(CLIENT_ID) as { clientSecret: string | null };
		expect(row.clientSecret).toBeNull();
	});

	it('does not register or accept localhost in the production client configuration', async () => {
		process.env.NODE_ENV = 'production';
		process.env.MINDMAP_OAUTH_REDIRECT_URIS =
			'https://mindmap.thoughtful-ai.com/';
		try {
			await provisionTrustedOAuthClients(auth);
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
			await provisionTrustedOAuthClients(auth);
		}
	});

	it('treats unset Mindmap config as disabled: provisioning no-ops, tokens are refused', async () => {
		const { accessToken } = await issueToken();
		process.env.MINDMAP_OAUTH_CLIENT_ID = '';
		process.env.MINDMAP_OAUTH_REDIRECT_URIS = '';
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		try {
			await expect(provisionTrustedOAuthClients(auth)).resolves.toBeUndefined();
			const response = await app.request('/api/openai/chat/completions', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${accessToken}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ model: 'gpt-4o' }),
			});
			expect(response.status).toBe(401);
			expect(fetchMock).not.toHaveBeenCalled();
		} finally {
			process.env.MINDMAP_OAUTH_CLIENT_ID = CLIENT_ID;
			process.env.MINDMAP_OAUTH_REDIRECT_URIS = REDIRECT_URI;
		}
	});
});
