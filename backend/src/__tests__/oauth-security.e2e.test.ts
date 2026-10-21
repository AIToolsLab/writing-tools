/**
 * Security assurances for apps that sign in with our server ("Log in with
 * Thoughtful"), tested end to end.
 *
 * HOW TO READ THIS FILE
 *
 * Each `it(...)` is one promise we make, written as a sentence. The body tells a
 * short story: what an attacker tries, and what the server must do about it.
 * Read the `it` titles first; they're the summary.
 *
 * Every request goes over real HTTP to the real server (the same `createApp`
 * that runs in production), so the cookies, redirects and headers are real.
 * Two things are faked, because a test can't use the real ones:
 *   - Google. "Alice signs in" uses anonymous sign-in instead, which creates
 *     the same kind of session that Google sign-in does.
 *   - OpenAI. A spy stands in for api.openai.com and counts the requests that
 *     reach it. "reachedOpenAI: false" means no money was spent.
 *
 * THE CAST
 *   - Alice: a real user with her own browser.
 *   - Mindmap: our app on another site. Alice logs into it with her Thoughtful
 *     account (OAuth), and it gets a token it can use to call the AI proxy.
 *   - Mallory: an attacker. She can send Alice links, read anything that passes
 *     through her own site, and call our server however she likes.
 *
 * The happy path (Alice really logging into Mindmap) is checked by hand and in
 * oauth-provider.integration.test.ts. The first test below runs it once anyway,
 * because a refusal only means something if the same request done correctly
 * would have worked.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import { getMigrations } from 'better-auth/db/migration';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Auth } from '../auth.js';
import { createApp } from '../app.js';
import { closeDb, db } from '../db.js';
import { provisionTrustedOAuthClients } from '../oauth-clients.js';

const MINDMAP_CLIENT_ID = 'mindmap-e2e';
const MINDMAP_REDIRECT = 'http://localhost:5181/';
const MALLORY_SITE = 'https://mallory.example/';

let ORIGIN: string; // our server, e.g. http://localhost:54321 (port chosen at startup)
let auth: Auth;
let server: ServerType;
let dataDir: string;

// --- The world the stories happen in ---------------------------------------

const realFetch = globalThis.fetch;
let openAIRequests = 0;

/** Stands in for api.openai.com: counts each request and answers with a tiny reply. */
function spyOnOpenAI(): void {
	vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(input instanceof Request ? input.url : String(input));
		if (url.hostname !== 'api.openai.com') return realFetch(input, init);
		openAIRequests++;
		return Response.json({
			id: 'fake',
			model: 'gpt-4o',
			choices: [],
			usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
		});
	});
}

/**
 * Sends one HTTP request and returns the response without following redirects.
 * The browser below uses this instead of fetch() because Node's fetch always
 * labels itself a script (`Sec-Fetch-Mode: cors`), and the login server
 * answers scripts with JSON where it would redirect a browser.
 */
function sendRaw(url: URL, method: string, headers: Headers, body?: string): Promise<Response> {
	return new Promise((resolve, reject) => {
		const req = httpRequest(url, { method, headers: Object.fromEntries(headers) }, (res) => {
			const chunks: Buffer[] = [];
			res.on('data', (chunk: Buffer) => chunks.push(chunk));
			res.on('end', () => {
				const responseHeaders = new Headers();
				for (const [name, value] of Object.entries(res.headers)) {
					for (const v of [value ?? []].flat()) responseHeaders.append(name, v);
				}
				const hasBody = ![204, 304].includes(res.statusCode!);
				resolve(new Response(hasBody ? Buffer.concat(chunks) : null, {
					status: res.statusCode,
					headers: responseHeaders,
				}));
			});
		});
		req.on('error', reject);
		req.end(body);
	});
}

/** A browser (or a script acting like one), with its own cookie jar. */
class Browser {
	private cookies = new Map<string, string>();

	/** Sends a request to our server. Redirects are returned, not followed. */
	async request(
		pathOrUrl: string | URL,
		init: { method?: string; headers?: Record<string, string>; body?: string } = {},
	): Promise<Response> {
		const headers = new Headers(init.headers);
		// Like a browser: following a link asks for a page (so the server answers
		// with a redirect, not JSON); a POST says which site it came from.
		if (!init.method || init.method === 'GET') {
			headers.set('Sec-Fetch-Mode', 'navigate');
			headers.set('Accept', 'text/html');
		} else {
			headers.set('Origin', ORIGIN);
		}
		if (this.cookies.size > 0) {
			headers.set('Cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '));
		}
		const response = await sendRaw(new URL(pathOrUrl, ORIGIN), init.method ?? 'GET', headers, init.body);
		for (const setCookie of response.headers.getSetCookie()) {
			const [pair] = setCookie.split(';', 1);
			const eq = pair!.indexOf('=');
			const [name, value] = [pair!.slice(0, eq), pair!.slice(eq + 1)];
			if (value) this.cookies.set(name, value);
			else this.cookies.delete(name);
		}
		return response;
	}

	postJson(pathname: string, body: unknown): Promise<Response> {
		return this.request(pathname, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
	}

	/** Stands in for "Sign in with Google" (see the top of this file). */
	async signIn(): Promise<{ userId: string; sessionId: string }> {
		expect((await this.postJson('/api/auth/sign-in/anonymous', {})).status).toBe(200);
		const { user, session } = (await (await this.request('/api/auth/get-session')).json()) as {
			user: { id: string };
			session: { id: string };
		};
		return { userId: user.id, sessionId: session.id };
	}

	async signOut(): Promise<void> {
		expect((await this.postJson('/api/auth/sign-out', {})).status).toBe(200);
	}
}

/** Where a response redirects the browser to, or null if it doesn't redirect. */
function redirectTarget(response: Response): URL | null {
	const location = response.headers.get('location');
	return location ? new URL(location, ORIGIN) : null;
}

// --- How Mindmap logs in (OAuth authorization code flow with PKCE) ----------
//
// 1. Mindmap makes up a secret (the PKCE "verifier") and sends Alice's browser to
//    our /authorize page with a hash of it (the "challenge").
// 2. If Alice is signed in, we send her back to Mindmap's registered address
//    with a one-time code.
// 3. Mindmap trades the code, plus the original secret, for an access token.

function mindmapLoginLink(overrides: Record<string, string | null> = {}) {
	const verifier = `verifier-${randomUUID()}-${randomUUID()}`;
	const params: Record<string, string | null> = {
		client_id: MINDMAP_CLIENT_ID,
		redirect_uri: MINDMAP_REDIRECT,
		response_type: 'code',
		scope: 'openai:chat',
		resource: ORIGIN,
		state: 'mindmap-state',
		code_challenge: createHash('sha256').update(verifier).digest('base64url'),
		code_challenge_method: 'S256',
		...overrides,
	};
	const url = new URL('/api/auth/oauth2/authorize', ORIGIN);
	for (const [key, value] of Object.entries(params)) {
		if (value !== null) url.searchParams.set(key, value);
	}
	return { url, verifier };
}

/** Step 3: trades a code (and the PKCE secret) for a token. Anyone can call this. */
function redeemCode(code: string, verifier: string): Promise<Response> {
	return realFetch(new URL('/api/auth/oauth2/token', ORIGIN), {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			client_id: MINDMAP_CLIENT_ID,
			redirect_uri: MINDMAP_REDIRECT,
			code,
			code_verifier: verifier,
		}),
	});
}

/** The whole honest flow: signed-in `user` logs into Mindmap; returns Mindmap's token. */
async function mindmapLogsIn(user: Browser): Promise<string> {
	const { url, verifier } = mindmapLoginLink();
	const code = redirectTarget(await user.request(url))?.searchParams.get('code');
	expect(code, 'Alice should get a code back').toBeTruthy();
	const response = await redeemCode(code!, verifier);
	expect(response.status).toBe(200);
	return ((await response.json()) as { access_token: string }).access_token;
}

/** Calls the AI proxy with a bearer token, as Mindmap does. */
async function askOpenAI(
	token: string,
	{ endpoint = 'chat/completions', cookieFrom }: { endpoint?: string; cookieFrom?: Browser } = {},
): Promise<{ status: number; reachedOpenAI: boolean }> {
	const before = openAIRequests;
	const init = {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ model: 'gpt-4o' }),
	};
	const url = `/api/openai/${endpoint}`;
	const response = cookieFrom
		? await cookieFrom.request(url, init)
		: await realFetch(new URL(url, ORIGIN), init);
	return { status: response.status, reachedOpenAI: openAIRequests > before };
}

// --- Setup: start the real server on a free port -----------------------------

async function freePort(): Promise<number> {
	const probe = createServer().listen(0);
	await new Promise((resolve) => probe.once('listening', resolve));
	const { port } = probe.address() as { port: number };
	await new Promise((resolve) => probe.close(resolve));
	return port;
}

beforeAll(async () => {
	const port = await freePort();
	ORIGIN = `http://localhost:${port}`;
	dataDir = mkdtempSync(path.join(tmpdir(), 'writing-tools-oauth-e2e-'));
	Object.assign(process.env, {
		DATA_DIR: dataDir,
		NODE_ENV: 'test',
		BETTER_AUTH_SECRET: 'e2e-secret-that-is-at-least-32-characters-long',
		BETTER_AUTH_URL: ORIGIN,
		BETTER_AUTH_TRUSTED_ORIGINS: `${ORIGIN},${MINDMAP_REDIRECT}`,
		GOOGLE_CLIENT_ID: 'test-client',
		GOOGLE_CLIENT_SECRET: 'test-secret',
		MINDMAP_OAUTH_CLIENT_ID: MINDMAP_CLIENT_ID,
		MINDMAP_OAUTH_REDIRECT_URIS: MINDMAP_REDIRECT,
		OPENAI_API_KEY: 'test-openai-key',
		OPENAI_DEMO_API_KEY: 'test-demo-openai-key',
	});
	({ auth } = await import('../auth.js'));
	await (await getMigrations(auth.options)).runMigrations();
	await provisionTrustedOAuthClients(auth);
	server = serve({ fetch: createApp({ auth }).fetch, port, hostname: 'localhost' });
	await new Promise((resolve) => server.once('listening', resolve));
});

beforeEach(spyOnOpenAI);

afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
	closeDb();
	rmSync(dataDir, { recursive: true, force: true });
});

// --- The assurances ------------------------------------------------------------

describe('Logging into Mindmap with Thoughtful: security assurances', () => {
	it('(control) the honest path works: Alice logs into Mindmap and Mindmap can use the AI', async () => {
		const alice = new Browser();
		await alice.signIn();
		const token = await mindmapLogsIn(alice);
		expect(await askOpenAI(token)).toEqual({ status: 200, reachedOpenAI: true });
	});

	describe('Getting a token', () => {
		it("sends Alice's login code only to Mindmap's registered address", async () => {
			const alice = new Browser();
			await alice.signIn();

			// Mallory sends Alice a real-looking login link that asks for the code to
			// be delivered to Mallory's site instead of Mindmap's.
			const toMallory = mindmapLoginLink({ redirect_uri: MALLORY_SITE });
			const response = await alice.request(toMallory.url);
			expect(redirectTarget(response)?.origin).not.toBe(new URL(MALLORY_SITE).origin);
			expect(redirectTarget(response)?.searchParams.get('code') ?? null).toBeNull();

			// Same if she makes up an app of her own that we've never heard of.
			const unknownApp = mindmapLoginLink({ client_id: 'mallorys-app', redirect_uri: MALLORY_SITE });
			const response2 = await alice.request(unknownApp.url);
			expect(redirectTarget(response2)?.searchParams.get('code') ?? null).toBeNull();
		});

		it('refuses a login link that was edited on its way through the sign-in page', async () => {
			// Alice isn't signed in yet, so the login link takes her to our sign-in
			// page first. That page carries the original request, signed by us, and
			// resumes it after she signs in.
			const alice = new Browser();
			const toSignIn = await alice.request(mindmapLoginLink().url);
			const signInPage = redirectTarget(toSignIn)!;
			expect(signInPage.pathname).toBe('/api/oauth/login');

			// Mallory changes where the code should go, and then gets Alice to sign in
			// with the edited request.
			signInPage.searchParams.set('redirect_uri', MALLORY_SITE);
			const signIn = await alice.postJson('/api/auth/sign-in/anonymous', {
				oauth_query: signInPage.search.slice(1),
			});
			expect(signIn.status).toBe(400);
			expect(await signIn.json()).toMatchObject({ error: 'invalid_signature' });
		});

		it("makes a stolen code useless without Mindmap's secret (PKCE)", async () => {
			const alice = new Browser();
			await alice.signIn();
			const { url } = mindmapLoginLink();
			const code = redirectTarget(await alice.request(url))!.searchParams.get('code')!;

			// Mallory somehow sees the code (say, in a log or the browser history)
			// and tries to redeem it. She doesn't have Mindmap's secret.
			const response = await redeemCode(code, `mallorys-guess-${randomUUID()}-${randomUUID()}`);
			expect(response.status).toBeGreaterThanOrEqual(400);
			expect(await response.json()).not.toHaveProperty('access_token');
		});

		it('refuses a login link that skips PKCE', async () => {
			// Without a challenge, a stolen code wouldn't need a secret at all, so
			// such a request must never produce a code.
			const alice = new Browser();
			await alice.signIn();
			const { url } = mindmapLoginLink({ code_challenge: null, code_challenge_method: null });
			const back = redirectTarget(await alice.request(url));
			expect(back?.searchParams.get('code') ?? null).toBeNull();
			expect(back?.searchParams.get('error')).toBe('invalid_request');
		});

		it('lets each code be redeemed only once', async () => {
			const alice = new Browser();
			await alice.signIn();
			const { url, verifier } = mindmapLoginLink();
			const code = redirectTarget(await alice.request(url))!.searchParams.get('code')!;

			expect((await redeemCode(code, verifier)).status).toBe(200);
			// Replaying the exact same exchange (say, from a captured request) fails.
			const replay = await redeemCode(code, verifier);
			expect(replay.status).toBeGreaterThanOrEqual(400);
			expect(await replay.json()).not.toHaveProperty('access_token');
		});

		it("doesn't let anyone register a new app or change Mindmap's settings", async () => {
			// If Mallory could register an app, or add her site to Mindmap's
			// addresses, the address check above would be pointless.
			const appsBefore = db().prepare(`SELECT * FROM oauthClient`).all();
			const mallory = new Browser();
			await mallory.signIn(); // signed in, so it's not just "you need to log in"

			const attempts: Array<[string, unknown]> = [
				['/api/auth/oauth2/register', { redirect_uris: [MALLORY_SITE] }],
				[
					'/api/auth/oauth2/create-client',
					{ redirect_uris: [MALLORY_SITE], token_endpoint_auth_method: 'none' },
				],
				[
					'/api/auth/oauth2/update-client',
					{ client_id: MINDMAP_CLIENT_ID, update: { redirect_uris: [MALLORY_SITE] } },
				],
				['/api/auth/oauth2/delete-client', { client_id: MINDMAP_CLIENT_ID }],
			];
			for (const [pathname, body] of attempts) {
				const status = (await mallory.postJson(pathname, body)).status;
				expect([401, 403], pathname).toContain(status);
			}
			// She can't even list the apps.
			expect((await mallory.request('/api/auth/oauth2/get-clients')).status).toBe(401);

			expect(db().prepare(`SELECT * FROM oauthClient`).all()).toEqual(appsBefore);
		});
	});

	describe('Using a token', () => {
		it('refuses fake, altered, expired or misdirected tokens, without falling back to free demo access', async () => {
			const alice = new Browser();
			const { userId, sessionId } = await alice.signIn();
			const bob = new Browser();
			const bobs = await bob.signIn();

			// Our test runs inside the server, so it can sign tokens with the server's
			// own key. That lets us build tokens that carry a genuine signature but are
			// wrong in exactly one way. (Mallory couldn't even sign them.) Each one must
			// be refused for its own reason, not just because the signature is bad.
			const genuine = async (changes: Record<string, unknown> = {}) => {
				const now = Math.floor(Date.now() / 1000);
				const claims = {
					sub: userId, // the user
					sid: sessionId, // the sign-in session that approved Mindmap
					azp: MINDMAP_CLIENT_ID, // the app the token was issued to
					scope: 'openai:chat', // what it allows
					iss: `${ORIGIN}/api/auth`, // who issued it
					aud: ORIGIN, // who it's for
					iat: now,
					exp: now + 3600,
				};
				return (await auth.api.signJWT({ body: { payload: { ...claims, ...changes } } })).token;
			};
			const [header, payload, signature] = (await genuine()).split('.');
			const laterExpiry = Buffer.from(
				JSON.stringify({ ...JSON.parse(Buffer.from(payload!, 'base64url').toString()), exp: 9e9 }),
			).toString('base64url');
			const sessionJwt = ((await (await alice.request('/api/auth/token')).json()) as { token: string })
				.token;

			// The control: an unaltered token is accepted. So every refusal below is
			// caused by the one thing that was changed.
			expect((await askOpenAI(await genuine())).status).toBe(200);

			const badTokens: Array<[string, string]> = [
				['not a token at all', 'not-a-jwt'],
				['payload edited after signing (expiry pushed out)', `${header}.${laterExpiry}.${signature}`],
				['a different kind of token we sign: any signed-in user can get one', sessionJwt],
				['meant for a different server', await genuine({ aud: 'https://elsewhere.example' })],
				['issued by someone else', await genuine({ iss: 'https://elsewhere.example/api/auth' })],
				['allows something other than AI calls', await genuine({ scope: 'something:else' })],
				['issued to an app other than Mindmap', await genuine({ azp: 'mallorys-app' })],
				['expired', await genuine({ iat: 1, exp: 2 })],
				['not tied to a sign-in session', await genuine({ sid: undefined })],
				['tied to a session that does not exist', await genuine({ sid: 'no-such-session' })],
				["tied to someone else's session (Bob's)", await genuine({ sid: bobs.sessionId })],
			];
			for (const [why, token] of badTokens) {
				// 401, not 200-via-the-demo-key: a bad token is an error, never "anonymous".
				expect(await askOpenAI(token), why).toEqual({ status: 401, reachedOpenAI: false });
			}
		});

		it("can't be rescued by a valid cookie sent alongside a bad token", async () => {
			// A request that carries a token is judged by that token. If the token is
			// bad, Alice's signed-in cookie riding along doesn't make it OK.
			const alice = new Browser();
			await alice.signIn();
			for (const endpoint of ['chat/completions', 'realtime/session']) {
				const result = await askOpenAI('not-a-real-token', { endpoint, cookieFrom: alice });
				expect(result, endpoint).toEqual({ status: 401, reachedOpenAI: false });
			}
			// The same goes for Mindmap's real token outside the AI proxy (see the
			// next test): her cookie doesn't turn it into her session.
			const token = await mindmapLogsIn(alice);
			const handoff = await alice.request('/api/handoff', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: JSON.stringify({ tool_client_id: 'mindmap', scopes: ['openai:chat'] }),
			});
			expect(handoff.status).toBe(401);
		});

		it("works only on the AI proxy, not for anything else in Alice's account", async () => {
			// Mindmap was allowed to make AI calls for Alice. That's all: it can't
			// read or change her settings, delete her data, or launch other tools.
			const alice = new Browser();
			await alice.signIn();
			const token = await mindmapLogsIn(alice);
			const asMindmap = (method: string, body?: unknown): RequestInit => ({
				method,
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body),
			});

			const openAIRequestsBefore = openAIRequests;
			const elsewhere: Array<[string, RequestInit]> = [
				['/api/auth/get-session', asMindmap('GET')],
				['/api/log', asMindmap('POST', {})],
				['/api/me/consent', asMindmap('POST', { loggingConsent: 'usage' })],
				['/api/me/activity', asMindmap('DELETE')],
				['/api/handoff', asMindmap('POST', { tool_client_id: 'mindmap', scopes: ['openai:chat'] })],
				['/api/openai/realtime/session', asMindmap('POST', {})],
			];
			for (const [pathname, init] of elsewhere) {
				const response = await realFetch(new URL(pathname, ORIGIN), init);
				if (pathname === '/api/auth/get-session') {
					// This one answers 200 either way; what matters is that the body is
					// "no session", not Alice's.
					expect(await response.json(), pathname).toBeNull();
				} else {
					expect(response.status, pathname).toBe(401);
				}
			}
			expect(openAIRequests).toBe(openAIRequestsBefore);
		});

		it("stops working when Alice signs out of Thoughtful", async () => {
			const alice = new Browser();
			await alice.signIn();
			const token = await mindmapLogsIn(alice);
			expect((await askOpenAI(token)).status).toBe(200);

			await alice.signOut();
			expect(await askOpenAI(token)).toEqual({ status: 401, reachedOpenAI: false });
		});

		it("lets someone outside the beta sign in, but doesn't let them spend money", async () => {
			const outsider = new Browser();
			const { userId } = await outsider.signIn();
			// Google sign-in can't run in a test, so turn this user into what an
			// outside Google account looks like: a real (non-anonymous) user whose
			// address isn't on the allowlist.
			db()
				.prepare(`UPDATE user SET email = ?, isAnonymous = 0 WHERE id = ?`)
				.run('outsider@example.com', userId);

			const token = await mindmapLogsIn(outsider);
			expect(await askOpenAI(token)).toEqual({ status: 403, reachedOpenAI: false });
		});
	});
});
