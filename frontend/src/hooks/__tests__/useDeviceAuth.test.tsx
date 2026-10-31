// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserInfo } from '@/api/deviceAuth';

const fetchUserInfo = vi.fn<(token: string) => Promise<UserInfo>>();
const store: { token: string | null } = { token: null };

vi.mock('@/api/deviceAuth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/api/deviceAuth')>();
	return {
		...actual,
		fetchUserInfo: (token: string) => fetchUserInfo(token),
		requestDeviceCode: vi.fn(),
		pollForToken: vi.fn(),
		signOut: vi.fn(() => Promise.resolve(true)),
	};
});
vi.mock('@/api/authTokenStore', () => ({
	loadToken: () => store.token,
	persistToken: (t: string) => {
		store.token = t;
	},
	clearToken: () => {
		store.token = null;
	},
}));

const { NoSessionError } = await import('@/api/deviceAuth');
const { useDeviceAuth } = await import('../useDeviceAuth');

/** Render the hook with a persisted token and wait for hydration to finish. */
async function signedIn(isAllowed: boolean) {
	store.token = 'tok';
	fetchUserInfo.mockResolvedValueOnce({ id: 'u1', isAllowed });
	const hook = renderHook(() => useDeviceAuth());
	await waitFor(() => expect(hook.result.current.status).toBe('success'));
	return hook;
}

describe('useDeviceAuth.refresh', () => {
	beforeEach(() => fetchUserInfo.mockReset());
	afterEach(() => {
		store.token = null;
	});

	it('picks up an access grant made after sign-in', async () => {
		const { result } = await signedIn(false);
		expect(result.current.user?.isAllowed).toBe(false);

		fetchUserInfo.mockResolvedValueOnce({ id: 'u1', isAllowed: true });
		await act(() => result.current.refresh());

		expect(result.current.status).toBe('success');
		expect(result.current.user?.isAllowed).toBe(true);
		expect(fetchUserInfo).toHaveBeenLastCalledWith('tok');
	});

	it('falls back to the login screen when the session is gone', async () => {
		const { result } = await signedIn(false);

		fetchUserInfo.mockRejectedValueOnce(new NoSessionError());
		await act(() => result.current.refresh());

		expect(result.current.status).toBe('idle');
		expect(store.token).toBeNull();
	});

	it('keeps the session on a transport failure and rejects', async () => {
		const { result } = await signedIn(false);

		fetchUserInfo.mockRejectedValueOnce(
			new Error('get-session failed (502)'),
		);
		await act(async () => {
			await expect(result.current.refresh()).rejects.toThrow('502');
		});

		expect(result.current.status).toBe('success');
		expect(store.token).toBe('tok');
	});
});
