import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	betterAuthOrigin,
	mindmapOAuthClientId,
	mindmapOAuthRedirectUris,
} from '../config.js';

afterEach(() => vi.unstubAllEnvs());

describe('standalone Mindmap OAuth configuration', () => {
	it('canonicalizes the resource to an origin without a path or trailing slash', () => {
		vi.stubEnv('BETTER_AUTH_URL', 'https://APP.Thoughtful-AI.com/api/');
		expect(betterAuthOrigin()).toBe('https://app.thoughtful-ai.com');
	});

	it('defaults only the development client and localhost callback', () => {
		vi.stubEnv('NODE_ENV', 'development');
		vi.stubEnv('MINDMAP_OAUTH_CLIENT_ID', '');
		vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', '');
		expect(mindmapOAuthClientId()).toBe('writing-tools-mindmap');
		expect(mindmapOAuthRedirectUris()).toEqual(['http://localhost:5181/']);
	});

	it('has no production defaults that could register localhost', () => {
		vi.stubEnv('NODE_ENV', 'production');
		vi.stubEnv('MINDMAP_OAUTH_CLIENT_ID', '');
		vi.stubEnv('MINDMAP_OAUTH_REDIRECT_URIS', '');
		expect(mindmapOAuthClientId()).toBe('');
		expect(mindmapOAuthRedirectUris()).toEqual([]);
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
});
