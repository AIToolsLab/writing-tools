import type { Auth } from './auth.js';
import {
	mindmapOAuthClientId,
	mindmapOAuthRedirectUris,
} from './config.js';

function validateRedirectUri(redirectUri: string): void {
	let parsed: URL;
	try {
		parsed = new URL(redirectUri);
	} catch {
		throw new Error(
			'MINDMAP_OAUTH_REDIRECT_URIS must contain absolute HTTP(S) URLs.',
		);
	}
	if (!['http:', 'https:'].includes(parsed.protocol)) {
		throw new Error(
			'MINDMAP_OAUTH_REDIRECT_URIS must contain absolute HTTP(S) URLs.',
		);
	}
}

/**
 * Idempotently provision the fixed public Mindmap client through Better Auth's
 * adapter. The adapter owns storage encoding for booleans, dates, and arrays.
 * Updating the managed fields deliberately leaves `disabled` untouched so an
 * operator can revoke the client without restarting the process.
 */
export async function provisionTrustedMindmapClient(auth: Auth): Promise<void> {
	const clientId = mindmapOAuthClientId();
	const redirectUris = mindmapOAuthRedirectUris();
	if (!clientId || redirectUris.length === 0) {
		throw new Error(
			'MINDMAP_OAUTH_CLIENT_ID and MINDMAP_OAUTH_REDIRECT_URIS are required.',
		);
	}
	redirectUris.forEach(validateRedirectUri);

	const context = await auth.$context;
	const existing = await context.adapter.findOne({
		model: 'oauthClient',
		where: [{ field: 'clientId', value: clientId }],
	});
	const now = new Date();
	const managed = {
		clientId,
		skipConsent: true,
		scopes: ['openai:chat'],
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
			update: managed,
		});
		return;
	}

	await context.adapter.create({
		model: 'oauthClient',
		data: { ...managed, disabled: false, createdAt: now },
	});
}
