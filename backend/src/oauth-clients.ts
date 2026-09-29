import type { Auth } from './auth.js';
import { trustedOAuthClients, type TrustedOAuthClient } from './config.js';

function validateRedirectUri(client: TrustedOAuthClient, redirectUri: string): void {
	let parsed: URL | null = null;
	try {
		parsed = new URL(redirectUri);
	} catch {
		// fall through to the error below
	}
	if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
		throw new Error(
			`OAuth client ${client.clientId}: redirect URIs must be absolute HTTP(S) URLs.`,
		);
	}
}

/**
 * Idempotently provision every trusted public OAuth client (see
 * `trustedOAuthClients` in config.ts) through Better Auth's adapter. The adapter
 * owns storage encoding for booleans, dates, and arrays. Updating the managed
 * fields deliberately leaves `disabled` untouched so an operator can revoke a
 * client without restarting the process.
 */
export async function provisionTrustedOAuthClients(auth: Auth): Promise<void> {
	const clients = trustedOAuthClients();
	if (clients.length === 0) {
		throw new Error(
			'No trusted OAuth clients are configured (MINDMAP_OAUTH_CLIENT_ID and MINDMAP_OAUTH_REDIRECT_URIS).',
		);
	}
	const context = await auth.$context;
	for (const client of clients) {
		client.redirectUris.forEach((uri) => validateRedirectUri(client, uri));
		const existing = await context.adapter.findOne({
			model: 'oauthClient',
			where: [{ field: 'clientId', value: client.clientId }],
		});
		const now = new Date();
		const managed = {
			clientId: client.clientId,
			skipConsent: true,
			scopes: ['openai:chat'],
			updatedAt: now,
			name: client.name,
			uri: new URL(client.redirectUris[0]!).origin,
			redirectUris: client.redirectUris,
			tokenEndpointAuthMethod: 'none',
			grantTypes: ['authorization_code'],
			responseTypes: ['code'],
			public: true,
			type: 'user-agent-based',
			requirePKCE: true,
			// A public client holds no secret. Clear it explicitly so a pre-existing
			// row with this client id (e.g. once confidential) can't keep one.
			clientSecret: null,
		};

		if (existing) {
			await context.adapter.update({
				model: 'oauthClient',
				where: [{ field: 'clientId', value: client.clientId }],
				update: managed,
			});
			continue;
		}

		await context.adapter.create({
			model: 'oauthClient',
			data: { ...managed, disabled: false, createdAt: now },
		});
	}
}
