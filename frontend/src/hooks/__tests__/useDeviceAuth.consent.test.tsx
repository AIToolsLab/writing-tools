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
import { posthogConsentAction } from '@/pages/app/posthogConsentPolicy';
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
			const ticket = hook.result.current.beginConsentSave();
			hook.result.current.applyConsentSnapshot(
				{
					loggingConsent: 'none',
					consentUpdatedAt: '2026-07-28T12:00:00.000Z',
				},
				'stored-token',
				ticket,
			);
		});

		expect(hook.result.current.user?.loggingConsent).toBe('none');
		expect(hook.result.current.user?.consentUpdatedAt).toBe(
			'2026-07-28T12:00:00.000Z',
		);
	});

	// A save that STARTED after a reconcile began is newer than that reconcile's
	// read (or another ping will follow), so it supersedes it.
	it('a save started after a reconcile supersedes that reconcile', async () => {
		const hook = await mountSignedIn();

		const pending = deferred<UserInfo>();
		fetchUserInfo.mockReturnValueOnce(pending.promise);
		let done!: Promise<void>;
		act(() => {
			done = hook.result.current.reconcileConsentFromOtherTab();
		});

		act(() => {
			const ticket = hook.result.current.beginConsentSave();
			hook.result.current.applyConsentSnapshot(
				{
					loggingConsent: 'ai_output',
					consentUpdatedAt: '2026-07-28T12:00:00.000Z',
				},
				'stored-token',
				ticket,
			);
		});
		expect(hook.result.current.consentPending).toBe(false);

		await act(async () => {
			pending.resolve({ ...USER, loggingConsent: 'document' });
			await done;
		});
		expect(hook.result.current.user?.loggingConsent).toBe('ai_output');
	});

	// Regression (Codex round 2): this tab saves `usage`; while that response is
	// delayed, another tab saves `none` and pings. The delayed `usage` response
	// must not override the newer withdrawal, whether the ping's reconcile has
	// already published (case 1) or is still in flight (case 2).
	describe('a delayed save response vs. a newer change from another tab', () => {
		const T_SAVE = '2026-07-28T12:00:00.000Z'; // this tab's write (older)
		const T_OTHER = '2026-07-28T12:00:05.000Z'; // other tab's write (newer)
		const SERVER_NOW: UserInfo = {
			...USER,
			loggingConsent: 'none',
			consentUpdatedAt: T_OTHER,
		};

		function captureAllowed(
			hook: Awaited<ReturnType<typeof mountSignedIn>>,
		) {
			const s = hook.result.current;
			return posthogConsentAction({
				isAuthenticated: s.status === 'success',
				hasSetConsent: !!s.user?.consentUpdatedAt,
				consentPending: s.consentPending,
				loggingConsent: s.user?.loggingConsent ?? 'none',
				userId: s.user?.id,
			}).capture;
		}

		it('case 1: the reconcile already published `none`', async () => {
			const hook = await mountSignedIn();
			const ticket = hook.result.current.beginConsentSave();

			// The other tab's ping arrives and its reconcile lands first.
			fetchUserInfo.mockResolvedValueOnce(SERVER_NOW);
			await act(async () => {
				await hook.result.current.reconcileConsentFromOtherTab();
			});
			expect(hook.result.current.user?.loggingConsent).toBe('none');

			// Now this tab's older save response arrives. It triggers a re-read
			// instead of publishing `usage`.
			const reread = deferred<UserInfo>();
			fetchUserInfo.mockReturnValueOnce(reread.promise);
			act(() => {
				hook.result.current.applyConsentSnapshot(
					{ loggingConsent: 'usage', consentUpdatedAt: T_SAVE },
					'stored-token',
					ticket,
				);
			});
			expect(hook.result.current.user?.loggingConsent).toBe('none');
			expect(hook.result.current.consentPending).toBe(true);
			expect(captureAllowed(hook)).toBe(false);

			await act(async () => {
				reread.resolve(SERVER_NOW);
				await reread.promise;
			});
			expect(hook.result.current.user?.loggingConsent).toBe('none');
			expect(hook.result.current.user?.consentUpdatedAt).toBe(T_OTHER);
			expect(hook.result.current.consentPending).toBe(false);
			expect(captureAllowed(hook)).toBe(false);
		});

		it('case 2: the reconcile is still in flight', async () => {
			const hook = await mountSignedIn();
			const ticket = hook.result.current.beginConsentSave();

			const firstRead = deferred<UserInfo>();
			fetchUserInfo.mockReturnValueOnce(firstRead.promise);
			let firstDone!: Promise<void>;
			act(() => {
				firstDone = hook.result.current.reconcileConsentFromOtherTab();
			});

			const reread = deferred<UserInfo>();
			fetchUserInfo.mockReturnValueOnce(reread.promise);
			act(() => {
				hook.result.current.applyConsentSnapshot(
					{ loggingConsent: 'usage', consentUpdatedAt: T_SAVE },
					'stored-token',
					ticket,
				);
			});
			// Still failing closed: the save did not publish `usage`.
			expect(hook.result.current.user?.loggingConsent).toBe('none');
			expect(hook.result.current.consentPending).toBe(true);
			expect(captureAllowed(hook)).toBe(false);

			await act(async () => {
				firstRead.resolve(SERVER_NOW);
				await firstDone;
				reread.resolve(SERVER_NOW);
				await reread.promise;
			});
			expect(hook.result.current.user?.loggingConsent).toBe('none');
			expect(hook.result.current.consentPending).toBe(false);
			expect(captureAllowed(hook)).toBe(false);
		});

		// The save itself succeeded, so the onboarding gate must not trap the
		// user even if the authoritative re-read fails.
		it('keeps the set-consent marker but stays at none if the re-read fails', async () => {
			fetchUserInfo.mockResolvedValue({
				...USER,
				consentUpdatedAt: null,
			});
			const hook = renderHook(() => useDeviceAuth());
			await waitFor(() =>
				expect(hook.result.current.status).toBe('success'),
			);
			const ticket = hook.result.current.beginConsentSave();

			fetchUserInfo.mockRejectedValueOnce(new Error('offline'));
			await act(async () => {
				await hook.result.current.reconcileConsentFromOtherTab();
			});

			fetchUserInfo.mockRejectedValueOnce(new Error('offline'));
			await act(async () => {
				hook.result.current.applyConsentSnapshot(
					{ loggingConsent: 'usage', consentUpdatedAt: T_SAVE },
					'stored-token',
					ticket,
				);
				await Promise.resolve();
			});
			await waitFor(() =>
				expect(hook.result.current.consentPending).toBe(false),
			);
			expect(hook.result.current.user?.consentUpdatedAt).toBe(T_SAVE);
			expect(hook.result.current.user?.loggingConsent).toBe('none');
		});
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
				hook.result.current.beginConsentSave(),
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

	// Regression (Codex round 3): a ping that arrives while the session is still
	// loading must not be dropped. The loading fetch may predate the other tab's
	// withdrawal, so the session is installed at `none` and reconciled at once.
	describe('a consent change from another tab while the session is loading', () => {
		const WITHDRAWN: UserInfo = {
			...USER,
			loggingConsent: 'none',
			consentUpdatedAt: '2026-07-28T12:00:05.000Z',
		};

		function captureAllowed(s: ReturnType<typeof useDeviceAuth>) {
			return posthogConsentAction({
				isAuthenticated: s.status === 'success',
				hasSetConsent: !!s.user?.consentUpdatedAt,
				consentPending: s.consentPending,
				loggingConsent: s.user?.loggingConsent ?? 'none',
				userId: s.user?.id,
			}).capture;
		}

		it('during hydrate-on-mount', async () => {
			const hydrate = deferred<UserInfo>();
			fetchUserInfo.mockReturnValueOnce(hydrate.promise);
			const hook = renderHook(() => useDeviceAuth());
			expect(hook.result.current.status).toBe('hydrating');

			// The other tab's ping lands before the session does.
			await act(async () => {
				await hook.result.current.reconcileConsentFromOtherTab();
			});

			const reread = deferred<UserInfo>();
			fetchUserInfo.mockReturnValueOnce(reread.promise);
			await act(async () => {
				hydrate.resolve(USER); // read before the withdrawal: `usage`
				await hydrate.promise;
			});
			expect(hook.result.current.status).toBe('success');
			expect(hook.result.current.user?.loggingConsent).toBe('none');
			expect(hook.result.current.consentPending).toBe(true);
			expect(captureAllowed(hook.result.current)).toBe(false);

			await act(async () => {
				reread.resolve(WITHDRAWN);
				await reread.promise;
			});
			expect(hook.result.current.user?.loggingConsent).toBe('none');
			expect(hook.result.current.consentPending).toBe(false);
			expect(captureAllowed(hook.result.current)).toBe(false);
			expect(fetchUserInfo).toHaveBeenCalledTimes(2);
		});

		it('while a fresh sign-in is verifying its token', async () => {
			fetchUserInfo.mockRejectedValueOnce(new Error('no stored session'));
			const hook = renderHook(() => useDeviceAuth());
			await waitFor(() =>
				expect(hook.result.current.status).toBe('idle'),
			);

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
				accessToken: 'token-new',
			});
			const verify = deferred<UserInfo>();
			fetchUserInfo.mockReturnValueOnce(verify.promise);
			let started!: Promise<void>;
			act(() => {
				started = hook.result.current.start();
			});
			await waitFor(() =>
				expect(fetchUserInfo).toHaveBeenLastCalledWith(
					'token-new',
					expect.anything(),
				),
			);

			await act(async () => {
				await hook.result.current.reconcileConsentFromOtherTab();
			});

			fetchUserInfo.mockResolvedValueOnce(WITHDRAWN);
			await act(async () => {
				verify.resolve(USER);
				await started;
			});
			await waitFor(() =>
				expect(hook.result.current.consentPending).toBe(false),
			);
			expect(hook.result.current.token).toBe('token-new');
			expect(hook.result.current.user?.loggingConsent).toBe('none');
			expect(captureAllowed(hook.result.current)).toBe(false);
		});

		// A ping while signed out says nothing about a session that hasn't been
		// requested yet; starting a sign-in clears it, so no extra re-read happens.
		it('a ping while signed out does not trigger a re-read after sign-in', async () => {
			fetchUserInfo.mockRejectedValueOnce(new Error('no stored session'));
			const hook = renderHook(() => useDeviceAuth());
			await waitFor(() =>
				expect(hook.result.current.status).toBe('idle'),
			);

			await act(async () => {
				await hook.result.current.reconcileConsentFromOtherTab();
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
				accessToken: 'token-new',
			});
			fetchUserInfo.mockResolvedValueOnce(USER);
			await act(async () => {
				await hook.result.current.start();
			});

			expect(hook.result.current.user?.loggingConsent).toBe('usage');
			expect(hook.result.current.consentPending).toBe(false);
			// The failed hydrate + the sign-in verify; no reconcile fetch.
			expect(fetchUserInfo).toHaveBeenCalledTimes(2);
		});
	});
});
