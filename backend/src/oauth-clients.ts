import { db } from './db.js';
import {
	mindmapOAuthClientId,
	mindmapOAuthRedirectUris,
} from './config.js';

/**
 * Replace every previously dynamically registered OAuth client with the one
 * configured first-party Mindmap client. Better Auth owns the table schema;
 * this provisioning runs only after its migrations and is safe on every boot.
 */
export function provisionTrustedMindmapClient(): void {
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

	const conn = db();
	const now = new Date().toISOString();
	conn.transaction(() => {
		// Dynamic registration used random client ids. No other fixed OAuth clients
		// exist today, so the configured Mindmap row is the sole survivor.
		conn.prepare(`DELETE FROM oauthClient WHERE clientId <> ?`).run(clientId);
		conn.prepare(
			`INSERT INTO oauthClient
			 (id, clientId, disabled, skipConsent, scopes, createdAt, updatedAt,
			  name, uri, redirectUris, tokenEndpointAuthMethod, grantTypes,
			  responseTypes, public, type, requirePKCE)
			 VALUES (?, ?, 0, 1, ?, ?, ?, ?, ?, ?, 'none', ?, ?, 1,
			         'user-agent-based', 1)
			 ON CONFLICT(clientId) DO UPDATE SET
			  disabled = 0,
			  skipConsent = 1,
			  scopes = excluded.scopes,
			  updatedAt = excluded.updatedAt,
			  name = excluded.name,
			  uri = excluded.uri,
			  redirectUris = excluded.redirectUris,
			  tokenEndpointAuthMethod = 'none',
			  grantTypes = excluded.grantTypes,
			  responseTypes = excluded.responseTypes,
			  public = 1,
			  type = 'user-agent-based',
			  requirePKCE = 1`,
		).run(
			`trusted:${clientId}`,
			clientId,
			JSON.stringify(['openai:chat', 'doc:read']),
			now,
			now,
			'Writing Tools Mindmap',
			new URL(redirectUris[0]!).origin,
			JSON.stringify(redirectUris),
			JSON.stringify(['authorization_code']),
			JSON.stringify(['code']),
		);
	})();
}
