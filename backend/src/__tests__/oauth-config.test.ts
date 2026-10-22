import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	acceptedOAuthClientIds,
	betterAuthOrigin,
	trustedOAuthClients,
} from '../config.js';

afterEach(() => vi.unstubAllEnvs());

const PROD_REDIRECT = 'https://mindmap.thoughtful-ai.com/';

describe('trusted OAuth client configuration', () => {
	it('canonicalizes the resource to an origin without a path or trailing slash', () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://APP.Thoughtful-AI.com/api/');
		expect(betterAuthOrigin()).toBe('https://app.thoughtful-ai.com');
	});

	it('has no defaults in any environment, so nothing can register localhost', () => {
		for (const nodeEnv of ['development', 'production', '']) {
			vi.stubEnv('NODE_ENV', nodeEnv);
			vi.stubEnv('MINDMAP_OAUTH_CLIENT_ID', '');
			vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', '');
			expect(trustedOAuthClients()).toEqual([]);
			expect(acceptedOAuthClientIds()).toEqual([]);
		}
	});

	it('preserves exact configured redirects while removing duplicates', () => {
		vi.stubEnv('MINDMAP_OAUTH_CLIENT_ID', 'writing-tools-mindmap');
		vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', `${PROD_REDIRECT}, ${PROD_REDIRECT}`);
		expect(trustedOAuthClients().map((client) => client.redirectUris)).toEqual([
			[PROD_REDIRECT],
		]);
	});

	it('lists configured clients and drops incomplete entries', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('MINDMAP_OAUTH_CLIENT_ID', ' writing-tools-mindmap ');
		vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', PROD_REDIRECT);
		expect(trustedOAuthClients()).toEqual([
			{
				clientId: 'writing-tools-mindmap',
				name: 'Writing Tools Mindmap',
				redirectUris: [PROD_REDIRECT],
			},
		]);
		expect(acceptedOAuthClientIds()).toEqual(['writing-tools-mindmap']);

		// An id without redirects (or the reverse) is not provisioned or accepted.
		vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', '');
		expect(trustedOAuthClients()).toEqual([]);
		vi.stubEnv('MINDMAP_OAUTH_CLIENT_ID', '');
		vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', PROD_REDIRECT);
		expect(acceptedOAuthClientIds()).toEqual([]);
	});
});
