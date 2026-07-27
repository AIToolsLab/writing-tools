// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.hoisted so the spy exists before the hoisted vi.mock factory reads it.
const { fetchUserInfo } = vi.hoisted(() => ({ fetchUserInfo: vi.fn() }));

vi.mock('@/api/deviceAuth', () => ({
	fetchUserInfo,
	pollForToken: vi.fn(),
	requestDeviceCode: vi.fn(),
	signOut: vi.fn(),
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

		await act(async () => {
			second.resolve(USER);
			await secondDone;
		});
		expect(hook.result.current.consentPending).toBe(false);
	});

	it('applyConsentSnapshot updates the level and the set-consent marker', async () => {
		const hook = await mountSignedIn();

		act(() => {
			hook.result.current.applyConsentSnapshot({
				loggingConsent: 'none',
				consentUpdatedAt: '2026-07-28T12:00:00.000Z',
			});
		});

		expect(hook.result.current.user?.loggingConsent).toBe('none');
		expect(hook.result.current.user?.consentUpdatedAt).toBe(
			'2026-07-28T12:00:00.000Z',
		);
	});
});
