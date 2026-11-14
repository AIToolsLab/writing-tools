// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// vi.hoisted so the spies exist before the hoisted vi.mock factory reads them.
const { fetchUserInfo, pollForToken, requestDeviceCode, signOut } = vi.hoisted(
	() => ({
		fetchUserInfo: vi.fn(),
		pollForToken: vi.fn(),
		requestDeviceCode: vi.fn(),
		signOut: vi.fn(),
	}),
);

vi.mock('@/api/deviceAuth', () => ({
	fetchUserInfo,
	pollForToken,
	requestDeviceCode,
	signOut,
}));

vi.mock('@/api/authTokenStore', () => ({
	loadToken: () => 'stored-token',
	persistToken: vi.fn(),
	clearToken: vi.fn(),
}));

import type { UserInfo } from '@/api/deviceAuth';
import { useDeviceAuth } from '../useDeviceAuth';

const USER: UserInfo = {
	id: 'u1',
	name: 'Test',
	loggingConsent: 'usage',
	consentUpdatedAt: '2026-07-27T00:00:00.000Z',
};

/** Mount and let hydrate-on-mount settle into a signed-in session. */
async function mountSignedIn() {
	fetchUserInfo.mockResolvedValue(USER);
	const hook = renderHook(() => useDeviceAuth());
	await waitFor(() => expect(hook.result.current.status).toBe('success'));
	return hook;
}

describe('useDeviceAuth.applyConsentSnapshot', () => {
	it('updates the level and the set-consent marker', async () => {
		const hook = await mountSignedIn();

		act(() => {
			hook.result.current.applyConsentSnapshot(
				{
					loggingConsent: 'none',
					consentUpdatedAt: '2026-07-28T12:00:00.000Z',
				},
				'stored-token',
			);
		});

		expect(hook.result.current.user?.loggingConsent).toBe('none');
		expect(hook.result.current.user?.consentUpdatedAt).toBe(
			'2026-07-28T12:00:00.000Z',
		);
	});

	it('drops a snapshot saved under a different token', async () => {
		const hook = await mountSignedIn();

		act(() => {
			hook.result.current.applyConsentSnapshot(
				{
					loggingConsent: 'document',
					consentUpdatedAt: '2026-07-28T12:00:00.000Z',
				},
				'someone-elses-token',
			);
		});

		expect(hook.result.current.user?.loggingConsent).toBe('usage');
		expect(hook.result.current.user?.consentUpdatedAt).toBe(
			USER.consentUpdatedAt,
		);
	});
});
