import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	acceptedOAuthClientIds,
	betterAuthOrigin,
	mindmapOAuthClientId,
	mindmapOAuthRedirectUris,
	trustedOAuthClients,
} from '../config.js';

afterEach(() => vi.unstubAllEnvs());

describe('standalone Mindmap OAuth configuration', () => {
	it('canonicalizes the resource to an origin without a path or trailing slash', () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://APP.Thoughtful-AI.com/api/');
		expect(betterAuthOrigin()).toBe('https://app.thoughtful-ai.com');
	});

	it('has no defaults in any environment, so nothing can register localhost', () => {
		for (const nodeEnv of ['development', 'production', '']) {
			vi.stubEnv('NODE_ENV', nodeEnv);
			vi.stubEnv('MINDMAP_OAUTH_CLIENT_ID', '');
			vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', '');
			expect(mindmapOAuthClientId()).toBe('');
			expect(mindmapOAuthRedirectUris()).toEqual([]);
			expect(trustedOAuthClients()).toEqual([]);
		}
	});

	it('preserves exact configured redirects while removing duplicates', () => {
		vi.stubEnv(
			'MINDMAP_OAUTH_REDIRECT_URIS',
			'https://mindmap.thoughtful-ai.com/,https://mindmap.thoughtful-ai.com/',
		);
		expect(mindmapOAuthRedirectUris()).toEqual([
			'https://mindmap.thoughtful-ai.com/',
		]);
	});

	it('lists trusted clients from config and drops incomplete entries', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('MINDMAP_OAUTH_CLIENT_ID', 'writing-tools-mindmap');
		vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', 'https://mindmap.thoughtful-ai.com/');
		expect(trustedOAuthClients()).toEqual([
			{
				clientId: 'writing-tools-mindmap',
				name: 'Writing Tools Mindmap',
				redirectUris: ['https://mindmap.thoughtful-ai.com/'],
			},
		]);
		expect(acceptedOAuthClientIds()).toEqual(['writing-tools-mindmap']);

		vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', '');
		expect(trustedOAuthClients()).toEqual([]);
		expect(acceptedOAuthClientIds()).toEqual([]);
	});
});
