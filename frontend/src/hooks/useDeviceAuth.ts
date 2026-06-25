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
	/** Best-effort server sign-out, then clear local state. */
	logout: () => Promise<void>;
}

const INITIAL: DeviceAuthState = { status: 'idle' };

export function useDeviceAuth(): UseDeviceAuth {
	const [state, setState] = useState<DeviceAuthState>(INITIAL);
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

	return { ...state, start, reset, logout };
}
