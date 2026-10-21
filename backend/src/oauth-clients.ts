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
			// Identify the client by its hardcoded display name, not the env-sourced
			// id: this message reaches the migration log, and CodeQL
			// (js/clear-text-logging) treats env values as sensitive.
			`OAuth client "${client.name}": redirect URIs must be absolute HTTP(S) URLs.`,
		);
	}
}

/**
 * Idempotently provision every trusted public OAuth client (see
 * `trustedOAuthClients` in config.ts) through Better Auth's adapter. The adapter
 * owns storage encoding for booleans, dates, and arrays. Updating the managed
 * fields deliberately leaves `disabled` untouched so an operator can stop new
 * grants without restarting the process (already-issued JWTs stay valid until
 * they expire). With no clients configured this is a no-op.
 */
export async function provisionTrustedOAuthClients(auth: Auth): Promise<void> {
	const context = await auth.$context;
	for (const client of trustedOAuthClients()) {
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
