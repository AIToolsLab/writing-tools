import { getOAuthProviderState } from '@better-auth/oauth-provider';
import {
	APIError,
	createAuthEndpoint,
	getSessionFromCtx,
	sessionMiddleware,
} from 'better-auth/api';
import { z } from 'zod';
import { getRoomForUser } from './rooms.js';

interface OAuthAuthorizationContext {
	state: string;
	roomId: string;
	clientId: string;
	redirectUri: string;
}

/** Read the OAuth Provider plugin's already signature-verified request context. */
export async function currentOAuthAuthorization(): Promise<OAuthAuthorizationContext> {
	const providerState = await getOAuthProviderState();
	if (!providerState?.query) {
		throw new APIError('BAD_REQUEST', {
			message: 'Missing verified OAuth authorization context.',
		});
	}
	return parseOAuthAuthorizationQuery(providerState.query);
}

export function parseOAuthAuthorizationQuery(
	value: string,
): OAuthAuthorizationContext {
	const query = new URLSearchParams(value);
	const state = query.get('state') ?? '';
	const roomId = state.split('.', 1)[0] ?? '';
	const clientId = query.get('client_id') ?? '';
	const redirectUri = query.get('redirect_uri') ?? '';
	if (!state || !roomId.startsWith('room_') || !clientId || !redirectUri) {
		throw new APIError('BAD_REQUEST', {
			message: 'Invalid room authorization request.',
		});
	}
	return { state, roomId, clientId, redirectUri };
}

export function roomOAuthAuthorization() {
	// Load-bearing coupling with @better-auth/oauth-provider: its global before
	// hook matches endpoints whose parsed body contains `oauth_query`, verifies the
	// signature and expiry, then populates the async-local provider state read by
	// currentOAuthAuthorization(). The handlers do not read this field directly,
	// but removing it would bypass that hook and leave no verified request context.
	const body = z.object({ oauth_query: z.string().min(1) });
	return {
		id: 'room-oauth-authorization',
		endpoints: {
			oauthRoomContext: createAuthEndpoint(
				'/oauth2/room-context',
				{ method: 'POST', body, use: [sessionMiddleware] },
				async (ctx) => {
					const session = await getSessionFromCtx(ctx);
					if (!session) throw new APIError('UNAUTHORIZED');
					const authorization = await currentOAuthAuthorization();
					const room = getRoomForUser(
						authorization.roomId,
						session.user.id,
					);
					if (!room) {
						throw new APIError('NOT_FOUND', {
							message: 'The launched room was not found for this account.',
						});
					}
					const client = (await ctx.context.adapter.findOne({
						model: 'oauthClient',
						where: [{ field: 'clientId', value: authorization.clientId }],
					})) as
						| { clientId: string; name?: string | null; redirectUris?: string[] }
						| null;
					if (!client?.redirectUris?.includes(authorization.redirectUri)) {
						throw new APIError('BAD_REQUEST', {
							message: 'The OAuth client or redirect URI is no longer registered.',
						});
					}
					return ctx.json({
						room: { id: room.id, name: room.name },
						client: {
							id: client.clientId,
							name: client.name || client.clientId,
							redirect_origin: new URL(authorization.redirectUri).origin,
						},
					});
				},
			),
		},
	} as const;
}
