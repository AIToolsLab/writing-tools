import { describe, expect, it } from 'vitest';
import { parseOAuthAuthorizationQuery } from '../oauth-room-authorization.js';

describe('OAuth room authorization context', () => {
	it('derives the exact launched room and client from the verified query', () => {
		expect(
			parseOAuthAuthorizationQuery(
				new URLSearchParams({
					state: 'room_exact.random-csrf',
					client_id: 'dynamic-client',
					redirect_uri: 'https://mindmap.example/callback',
				}).toString(),
			),
		).toEqual({
			state: 'room_exact.random-csrf',
			roomId: 'room_exact',
			clientId: 'dynamic-client',
			redirectUri: 'https://mindmap.example/callback',
		});
	});

	it('fails closed when the authorization lacks a room-bound state', () => {
		expect(() =>
			parseOAuthAuthorizationQuery(
				'state=random&client_id=client&redirect_uri=https%3A%2F%2Fapp.example',
			),
		).toThrow();
	});
});
