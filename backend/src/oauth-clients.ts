import type { Auth } from './auth.js';
import {
	betterAuthOrigin,
	trustedOAuthClients,
	type TrustedOAuthClient,
} from './config.js';

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
 *
 * Also provisions the one protected resource (this server's origin, the JWT
 * audience the proxy accepts) and links each client to it. Better Auth 1.7
 * refuses an authorize or token request for a resource the client isn't linked
 * to, so without the link every authorization fails with invalid_target.
 */
export async function provisionTrustedOAuthClients(auth: Auth): Promise<void> {
	const context = await auth.$context;
	const clients = trustedOAuthClients();
	if (clients.length === 0) return;

	const resource = betterAuthOrigin();
	const existingResource = await context.adapter.findOne({
		model: 'oauthResource',
		where: [{ field: 'identifier', value: resource }],
	});
	const resourceFields = {
		name: 'Writing Tools API',
		// Tokens for this resource can carry only the proxy scope, whatever a
		// client's own scope list says.
		allowedScopes: ['openai:chat'],
		updatedAt: new Date(),
	};
	if (existingResource) {
		await context.adapter.update({
			model: 'oauthResource',
			where: [{ field: 'identifier', value: resource }],
			update: resourceFields,
		});
	} else {
		await context.adapter.create({
			model: 'oauthResource',
			data: {
				...resourceFields,
				identifier: resource,
				disabled: false,
				policyVersion: 1,
				createdAt: new Date(),
			},
		});
	}

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
		} else {
			await context.adapter.create({
				model: 'oauthClient',
				data: { ...managed, disabled: false, createdAt: now },
			});
		}

		const linked = await context.adapter.findOne({
			model: 'oauthClientResource',
			where: [
				{ field: 'clientId', value: client.clientId },
				{ field: 'resourceId', value: resource },
			],
		});
		if (!linked) {
			await context.adapter.create({
				model: 'oauthClientResource',
				data: { clientId: client.clientId, resourceId: resource, createdAt: now },
			});
		}
	}
}
