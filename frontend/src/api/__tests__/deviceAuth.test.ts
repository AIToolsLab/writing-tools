import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep the service off the real ./index (which pulls Office/Google editor APIs);
// only SERVER_URL is needed.
vi.mock('../index', () => ({ SERVER_URL: '/api' }));

import {
	pollForToken,
	requestDeviceCode,
	fetchUserInfo,
} from '../deviceAuth';

type Json = Record<string, unknown>;
const resp = (data: Json, ok = false) =>
	({ ok, json: () => Promise.resolve(data) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('requestDeviceCode', () => {
	it('returns the parsed code on success', async () => {
		fetchMock.mockResolvedValueOnce(
			resp(
				{
					device_code: 'dev',
					user_code: 'ABCD-1234',
					verification_uri: '/api/device',
					verification_uri_complete: '/api/device?user_code=ABCD-1234',
					expires_in: 600,
					interval: 5,
				},
				true,
			),
		);
		const code = await requestDeviceCode();
		expect(code.user_code).toBe('ABCD-1234');
		expect(code.device_code).toBe('dev');
	});

	it('throws on a non-ok response', async () => {
		fetchMock.mockResolvedValueOnce(resp({ error: 'invalid_client' }));
		await expect(requestDeviceCode()).rejects.toThrow(/device\/code failed/);
	});
});

describe('pollForToken', () => {
	it('resolves with the token after authorization_pending', async () => {
		vi.useFakeTimers();
		fetchMock
			.mockResolvedValueOnce(resp({ error: 'authorization_pending' }))
			.mockResolvedValueOnce(resp({ access_token: 'tok-123' }, true));

		const promise = pollForToken('dev', 1);
		await vi.runAllTimersAsync();
		await expect(promise).resolves.toEqual({
			type: 'token',
			accessToken: 'tok-123',
		});
	});

	it('keeps polling after slow_down and still resolves with the token', async () => {
		vi.useFakeTimers();
		fetchMock
			.mockResolvedValueOnce(resp({ error: 'slow_down' }))
			.mockResolvedValueOnce(resp({ access_token: 'tok' }, true));

		const promise = pollForToken('dev', 5);
		await vi.runAllTimersAsync();
		await expect(promise).resolves.toEqual({
			type: 'token',
			accessToken: 'tok',
		});
	});

	it('returns denied on access_denied', async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValueOnce(resp({ error: 'access_denied' }));
		const promise = pollForToken('dev', 1);
		await vi.runAllTimersAsync();
		await expect(promise).resolves.toEqual({ type: 'denied' });
	});

	it('returns expired on expired_token', async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValueOnce(resp({ error: 'expired_token' }));
		const promise = pollForToken('dev', 1);
		await vi.runAllTimersAsync();
		await expect(promise).resolves.toEqual({ type: 'expired' });
	});

	it('returns error on an unexpected error code', async () => {
		vi.useFakeTimers();
		fetchMock.mockResolvedValueOnce(resp({ error: 'boom' }));
		const promise = pollForToken('dev', 1);
		await vi.runAllTimersAsync();
		const result = await promise;
		expect(result.type).toBe('error');
	});

	it('returns aborted when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			pollForToken('dev', 1, controller.signal),
		).resolves.toEqual({ type: 'aborted' });
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('fetchUserInfo', () => {
	it('returns the user on 200', async () => {
		fetchMock.mockResolvedValueOnce(
			resp({ email: 'a@calvin.edu', name: 'A' }, true),
		);
		await expect(fetchUserInfo('tok')).resolves.toEqual({
			email: 'a@calvin.edu',
			name: 'A',
		});
	});

	it('throws on 401', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 401,
			json: () => Promise.resolve({}),
		} as Response);
		await expect(fetchUserInfo('tok')).rejects.toThrow(/protected failed/);
	});
});
