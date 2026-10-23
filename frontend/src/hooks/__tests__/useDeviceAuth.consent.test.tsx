// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

/** A promise plus the handle to settle it, so a refresh can be held mid-flight. */
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe('useDeviceAuth — cross-tab consent reconciliation', () => {
	beforeEach(() => {
		fetchUserInfo.mockReset();
		pollForToken.mockReset();
		requestDeviceCode.mockReset();
		signOut.mockReset();
	});

	it('drops to none while reconciling, then adopts the authoritative level', async () => {
		const hook = await mountSignedIn();

		const pending = deferred<UserInfo>();
		fetchUserInfo.mockReturnValueOnce(pending.promise);

		let done!: Promise<void>;
		act(() => {
			done = hook.result.current.reconcileConsentFromOtherTab();
		});

		// Fails closed immediately: the tab must not keep logging at the old level
		// while the authoritative one is still in flight.
		expect(hook.result.current.user?.loggingConsent).toBe('none');
		expect(hook.result.current.consentPending).toBe(true);

		await act(async () => {
			pending.resolve({ ...USER, loggingConsent: 'document' });
			await done;
		});

		expect(hook.result.current.user?.loggingConsent).toBe('document');
		expect(hook.result.current.consentPending).toBe(false);
	});

	// The whole point of failing closed: a refresh that never lands must leave the
	// tab silent, not back at the level the user may have just withdrawn.
	it('stays at none when the refresh fails, and stops being pending', async () => {
		const hook = await mountSignedIn();

		fetchUserInfo.mockRejectedValueOnce(new Error('offline'));
		await act(async () => {
			await hook.result.current.reconcileConsentFromOtherTab();
		});

		expect(hook.result.current.user?.loggingConsent).toBe('none');
		// `none` is now a settled answer rather than a provisional one, so consumers
		// that defer irreversible work (the PostHog identity reset) may proceed.
		expect(hook.result.current.consentPending).toBe(false);
	});

	// Regression: with a bare boolean, the first ping to finish would clear the
	// flag while the second was still in flight, briefly presenting a provisional
	// `none` as authoritative.
	it('stays pending until the last of two overlapping reconciles finishes', async () => {
		const hook = await mountSignedIn();

		const first = deferred<UserInfo>();
		const second = deferred<UserInfo>();
		fetchUserInfo
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);

		let firstDone!: Promise<void>;
		let secondDone!: Promise<void>;
		act(() => {
			firstDone = hook.result.current.reconcileConsentFromOtherTab();
			secondDone = hook.result.current.reconcileConsentFromOtherTab();
		});

		await act(async () => {
			first.resolve(USER);
			await firstDone;
		});
		expect(hook.result.current.consentPending).toBe(true);
		// The superseded response did not publish: still failing closed.
		expect(hook.result.current.user?.loggingConsent).toBe('none');

		await act(async () => {
			second.resolve(USER);
			await secondDone;
		});
		expect(hook.result.current.consentPending).toBe(false);
	});

	// Regression (Codex HOLD #2): an older response arriving last must not restore
	// a level that the newer response withdrew.
	it('ignores an older reconcile response that lands after the newer one', async () => {
		const hook = await mountSignedIn();

		const older = deferred<UserInfo>();
		const newer = deferred<UserInfo>();
		fetchUserInfo
			.mockReturnValueOnce(older.promise)
			.mockReturnValueOnce(newer.promise);

		let olderDone!: Promise<void>;
		let newerDone!: Promise<void>;
		act(() => {
			olderDone = hook.result.current.reconcileConsentFromOtherTab();
			newerDone = hook.result.current.reconcileConsentFromOtherTab();
		});

		await act(async () => {
			newer.resolve({ ...USER, loggingConsent: 'none' });
			await newerDone;
		});
		await act(async () => {
			older.resolve({ ...USER, loggingConsent: 'document' });
			await olderDone;
		});

		expect(hook.result.current.user?.loggingConsent).toBe('none');
		expect(hook.result.current.consentPending).toBe(false);
	});

	it('stays at none when the latest reconcile fails, even if an older one succeeded', async () => {
		const hook = await mountSignedIn();

		const older = deferred<UserInfo>();
		const newer = deferred<UserInfo>();
		fetchUserInfo
			.mockReturnValueOnce(older.promise)
			.mockReturnValueOnce(newer.promise);

		let olderDone!: Promise<void>;
		let newerDone!: Promise<void>;
		act(() => {
			olderDone = hook.result.current.reconcileConsentFromOtherTab();
			newerDone = hook.result.current.reconcileConsentFromOtherTab();
		});

		await act(async () => {
			older.resolve({ ...USER, loggingConsent: 'document' });
			await olderDone;
		});
		// Still provisional — the older answer may already be out of date.
		expect(hook.result.current.user?.loggingConsent).toBe('none');
		expect(hook.result.current.consentPending).toBe(true);

		await act(async () => {
			newer.reject(new Error('offline'));
			await newerDone;
		});
		expect(hook.result.current.user?.loggingConsent).toBe('none');
		expect(hook.result.current.consentPending).toBe(false);
	});

	it('applyConsentSnapshot updates the level and the set-consent marker', async () => {
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

	// This tab's own save is newer than any read still in flight from a ping.
	it('applyConsentSnapshot supersedes an in-flight reconcile', async () => {
		const hook = await mountSignedIn();

		const pending = deferred<UserInfo>();
		fetchUserInfo.mockReturnValueOnce(pending.promise);
		let done!: Promise<void>;
		act(() => {
			done = hook.result.current.reconcileConsentFromOtherTab();
		});

		act(() => {
			hook.result.current.applyConsentSnapshot(
				{
					loggingConsent: 'ai_output',
					consentUpdatedAt: '2026-07-28T12:00:00.000Z',
				},
				'stored-token',
			);
		});
		expect(hook.result.current.consentPending).toBe(false);

		await act(async () => {
			pending.resolve({ ...USER, loggingConsent: 'document' });
			await done;
		});
		expect(hook.result.current.user?.loggingConsent).toBe('ai_output');
	});

	it('drops a consent snapshot saved under a different token', async () => {
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

	it('logout during a reconcile clears pending', async () => {
		const hook = await mountSignedIn();
		signOut.mockResolvedValueOnce(undefined);

		const pending = deferred<UserInfo>();
		fetchUserInfo.mockReturnValueOnce(pending.promise);
		act(() => {
			void hook.result.current.reconcileConsentFromOtherTab();
		});
		expect(hook.result.current.consentPending).toBe(true);

		await act(async () => {
			await hook.result.current.logout();
		});
		expect(hook.result.current.status).toBe('idle');
		expect(hook.result.current.consentPending).toBe(false);
	});

	// Regression (Codex HOLD #3): user A's late response must not land in user B's
	// session after logout → sign-in as B.
	it("does not write user A's late reconcile into user B's session", async () => {
		const hook = await mountSignedIn();
		const USER_B: UserInfo = {
			id: 'u2',
			name: 'B',
			loggingConsent: 'none',
			consentUpdatedAt: '2026-07-29T00:00:00.000Z',
		};

		const lateA = deferred<UserInfo>();
		fetchUserInfo.mockReturnValueOnce(lateA.promise);
		let lateDone!: Promise<void>;
		act(() => {
			lateDone = hook.result.current.reconcileConsentFromOtherTab();
		});

		signOut.mockResolvedValueOnce(undefined);
		await act(async () => {
			await hook.result.current.logout();
		});

		requestDeviceCode.mockResolvedValueOnce({
			device_code: 'dc',
			user_code: 'UC',
			verification_uri: 'https://example.test/device',
			verification_uri_complete: 'https://example.test/device?c=UC',
			expires_in: 600,
			interval: 1,
		});
		pollForToken.mockResolvedValueOnce({
			type: 'token',
			accessToken: 'token-B',
		});
		fetchUserInfo.mockResolvedValueOnce(USER_B);
		await act(async () => {
			await hook.result.current.start();
		});
		expect(hook.result.current.user?.id).toBe('u2');

		await act(async () => {
			lateA.resolve({ ...USER, loggingConsent: 'document' });
			await lateDone;
		});

		expect(hook.result.current.token).toBe('token-B');
		expect(hook.result.current.user).toEqual(USER_B);
		expect(hook.result.current.consentPending).toBe(false);
	});
});
