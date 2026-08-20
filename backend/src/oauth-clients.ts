import type { Auth } from './auth.js';
import {
	mindmapOAuthClientId,
	mindmapOAuthRedirectUris,
} from './config.js';

/**
 * Idempotently provision the configured first-party Mindmap client through
 * Better Auth's adapter so booleans, dates, and arrays use the provider's own
 * storage encoding. Stale dynamic clients are removed once by app migration v7.
 */
export async function provisionTrustedMindmapClient(auth: Auth): Promise<void> {
	const clientId = mindmapOAuthClientId();
	const redirectUris = mindmapOAuthRedirectUris();
	if (!clientId || redirectUris.length === 0) {
		throw new Error(
			'MINDMAP_OAUTH_CLIENT_ID and MINDMAP_OAUTH_REDIRECT_URIS are required in production.',
		);
	}

	for (const redirectUri of redirectUris) {
		const parsed = new URL(redirectUri);
		if (!['http:', 'https:'].includes(parsed.protocol)) {
			throw new Error(`Mindmap OAuth redirect URI must use HTTP(S): ${redirectUri}`);
		}
	}

	const context = await auth.$context;
	const existing = await context.adapter.findOne({
		model: 'oauthClient',
		where: [{ field: 'clientId', value: clientId }],
	});
	const now = new Date();
	const data = {
		clientId,
		skipConsent: true,
		scopes: ['openai:chat', 'doc:read'],
		updatedAt: now,
		name: 'Writing Tools Mindmap',
		uri: new URL(redirectUris[0]!).origin,
		redirectUris,
		tokenEndpointAuthMethod: 'none',
		grantTypes: ['authorization_code'],
		responseTypes: ['code'],
		public: true,
		type: 'user-agent-based',
		requirePKCE: true,
	};

	if (existing) {
		await context.adapter.update({
			model: 'oauthClient',
			where: [{ field: 'clientId', value: clientId }],
			update: data,
		});
		return;
	}

	await context.adapter.create({
		model: 'oauthClient',
		data: { ...data, disabled: false, createdAt: now },
	});
}
