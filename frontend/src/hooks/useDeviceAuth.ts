/**
 * React hook driving the interactive Better Auth device flow.
 *
 * Owns the state machine and the access token. The token is persisted (guarded
 * localStorage) so a page refresh restores the session via hydrate-on-mount instead of
 * forcing a fresh interactive login. Polling is cancellable: reset(), logout(), unmount,
 * or a fresh start() abort the in-flight loop via an AbortController. The abort signal is
 * the single source of truth for cancellation, so no mounted flag is needed.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	type DeviceCodeResponse,
	type UserInfo,
	fetchUserInfo,
	pollForToken,
	requestDeviceCode,
	signOut as signOutRequest,
} from '@/api/deviceAuth';
import { clearToken, loadToken, persistToken } from '@/api/authTokenStore';
import type { ConsentSnapshot } from '@/api/account';

export type DeviceAuthStatus =
	| 'idle'
	| 'hydrating' // validating a persisted token on mount
	| 'pending' // requesting the device code
	| 'polling' // waiting for the user to approve in the browser
	| 'success'
	| 'error';

export interface DeviceAuthState {
	status: DeviceAuthStatus;
	userCode?: string;
	verificationUri?: string;
	/** Epoch ms when the user code expires (from expires_in); drives the countdown. */
	expiresAt?: number;
	/** Present only on status==='success'. Held in memory only. */
	token?: string;
	user?: UserInfo;
	error?: string;
}

export interface UseDeviceAuth extends DeviceAuthState {
	/** Begin (or restart) the device flow. Aborts any in-flight attempt first. */
	start: () => Promise<void>;
	/** Cancel any in-flight flow and return to idle, clearing the token. */
	reset: () => void;
	/**
	 * Re-fetch the signed-in user with the current token and update state.user,
	 * without a re-login. Call after a server-side change to the user record
	 * (e.g. consent) so derived values reflect it live. A failed refresh is a
	 * no-op (keeps the last-known user); stale-token handling stays with
	 * hydrate-on-mount and the 401 path on real API calls, not this refresh.
	 */
	refreshUser: () => Promise<void>;
	/** Apply the authoritative consent response from this session's own save. */
	applyConsentSnapshot: (snapshot: ConsentSnapshot) => void;
	/**
	 * Fail closed, then re-fetch, after another tab changed consent. Resolves once
	 * the level in `user` is authoritative again.
	 */
	reconcileConsentFromOtherTab: () => Promise<void>;
	/**
	 * True while the above is in flight — i.e. `loggingConsent` is the provisional
	 * `none`, not a level the user chose. Consumers that do something irreversible
	 * on withdrawal (PostHog identity reset) must wait this out.
	 */
	consentPending: boolean;
	/** Best-effort server sign-out, then clear local state. */
	logout: () => Promise<void>;
}

const INITIAL: DeviceAuthState = { status: 'idle' };

export function useDeviceAuth(): UseDeviceAuth {
	const [state, setState] = useState<DeviceAuthState>(INITIAL);
	// Kept outside DeviceAuthState: it describes how much to trust the consent
	// level in `user`, not where the device flow is.
	const [consentPending, setConsentPending] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	// Mirror the token in a ref so logout() can read it without a stale closure.
	const tokenRef = useRef<string | undefined>(undefined);
	const abortInFlight = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	// Only commit state if this async attempt has not been aborted.
	const safeSet = useCallback(
		(controller: AbortController, next: DeviceAuthState) => {
			if (controller.signal.aborted) return;
			setState(next);
		},
		[],
	);

	const reset = useCallback(() => {
		abortInFlight();
		tokenRef.current = undefined;
		clearToken();
		setState(INITIAL);
	}, [abortInFlight]);

	// Re-pull the user with the current token; leave state untouched on failure or
	// if there's no token / no active success state. Only patches the user of an
	// existing success state, so it can't resurrect a signed-out session.
	const refreshUser = useCallback(async () => {
		const token = tokenRef.current;
		if (!token) return;
		try {
			const user = await fetchUserInfo(token);
			setState((s) => (s.status === 'success' ? { ...s, user } : s));
		} catch {
			// Non-critical: keep the last-known user rather than disrupting the UI.
		}
	}, []);

	// The consent endpoint returns exactly the values it persisted. Apply that
	// snapshot synchronously so an onboarding gate never depends on a follow-up
	// get-session request succeeding.
	const applyConsentSnapshot = useCallback((snapshot: ConsentSnapshot) => {
		setState((s) => {
			if (s.status !== 'success' || !s.user) return s;
			return {
				...s,
				user: { ...s.user, ...snapshot },
			};
		});
	}, []);

	// A different tab changed consent, possibly lowering it. Drop to the most
	// privacy-protective level first so this tab cannot keep logging on a stale
	// cached user, then re-fetch the authoritative one.
	//
	// The two steps are one function rather than two calls at the call site so the
	// provisional window has a defined end: `consentPending` brackets it exactly.
	// A consumer cannot otherwise distinguish this transient `none` from a level
	// the user actually chose, and acting on the difference matters (see the
	// PostHog bridge in pages/app/index.tsx).
	const pendingReconciles = useRef(0);
	const reconcileConsentFromOtherTab = useCallback(async () => {
		pendingReconciles.current += 1;
		setConsentPending(true);
		setState((s) => {
			if (s.status !== 'success' || !s.user) return s;
			return {
				...s,
				user: { ...s.user, loggingConsent: 'none' },
			};
		});
		try {
			await refreshUser();
		} finally {
			// Counted, not a bare boolean: with two pings in flight the first to
			// finish would otherwise declare the level authoritative while the
			// second is still provisional. A failed refresh still clears — we stay
			// at `none`, and that is now a settled answer, not a pending one.
			pendingReconciles.current -= 1;
			if (pendingReconciles.current === 0) setConsentPending(false);
		}
	}, [refreshUser]);

	const start = useCallback(async () => {
		// Abort any prior attempt and open a fresh controller.
		abortInFlight();
		const controller = new AbortController();
		abortRef.current = controller;
		tokenRef.current = undefined;

		setState({ status: 'pending' });

		let code: DeviceCodeResponse;
		try {
			code = await requestDeviceCode(controller.signal);
		} catch (e) {
			if (controller.signal.aborted) return;
			safeSet(controller, {
				status: 'error',
				error: (e as Error).message,
			});
			return;
		}

		safeSet(controller, {
			status: 'polling',
			userCode: code.user_code,
			// Generic page with NO code in the URL — the user reads the code from here
			// and types it on the approval page (intent/anti-phishing hardening).
			verificationUri: code.verification_uri,
			expiresAt: Date.now() + code.expires_in * 1000,
		});

		const result = await pollForToken(
			code.device_code,
			code.interval,
			controller.signal,
		);

		switch (result.type) {
			case 'aborted':
				return;
			case 'denied':
				safeSet(controller, {
					status: 'error',
					error: 'Access denied. The request was not approved.',
				});
				return;
			case 'expired':
				safeSet(controller, {
					status: 'error',
					error: 'The code expired. Start sign-in again.',
				});
				return;
			case 'error':
				safeSet(controller, { status: 'error', error: result.message });
				return;
			case 'token':
				break;
		}

		// Token acquired — verify it and load the user identity.
		try {
			const user = await fetchUserInfo(
				result.accessToken,
				controller.signal,
			);
			tokenRef.current = result.accessToken;
			persistToken(result.accessToken);
			safeSet(controller, {
				status: 'success',
				token: result.accessToken,
				user,
			});
		} catch (e) {
			if (controller.signal.aborted) return;
			safeSet(controller, {
				status: 'error',
				error: `Token verification failed: ${(e as Error).message}`,
			});
		}
	}, [abortInFlight, safeSet]);

	const logout = useCallback(async () => {
		const token = tokenRef.current;
		abortInFlight();
		// Best-effort; server-side invalidation is verified separately.
		try {
			if (token) {
				await signOutRequest(token);
			}
		} catch {
			// Best-effort, ignore server sign-out failure. Clear local state regardless.
		} finally {
			// Clear local state regardless of sign-out success, since the token is the
			// only proof of auth.
			tokenRef.current = undefined;
			clearToken();
			setState(INITIAL);
		}
	}, [abortInFlight]);

	useEffect(() => {
		const controller = new AbortController();
		abortRef.current = controller;

		// Hydrate: if a token was persisted, validate it instead of forcing a new login.
		const stored = loadToken();
		if (stored) {
			setState({ status: 'hydrating' });
			fetchUserInfo(stored, controller.signal)
				.then((user) => {
					tokenRef.current = stored;
					safeSet(controller, {
						status: 'success',
						token: stored,
						user,
					});
				})
				.catch(() => {
					if (controller.signal.aborted) return;
					// Stale/invalid token — drop it and fall back to login.
					clearToken();
					safeSet(controller, { status: 'idle' });
				});
		}

		// Abort any in-flight device flow / hydration when the component unmounts.
		return () => {
			abortRef.current?.abort();
			abortRef.current = null;
		};
	}, [safeSet]);

	return {
		...state,
		start,
		reset,
		refreshUser,
		applyConsentSnapshot,
		reconcileConsentFromOtherTab,
		consentPending,
		logout,
	};
}
