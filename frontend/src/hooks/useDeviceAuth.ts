/**
 * React hook driving the interactive Better Auth device flow.
 *
 * Owns the state machine and an in-memory access token (never persisted). Polling is
 * cancellable: reset(), logout(), unmount, or a fresh start() abort the in-flight loop
 * via an AbortController so a stale tick cannot deliver a token after the user leaves.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
	type DeviceCodeResponse,
	type ProtectedUser,
	fetchProtectedUser,
	pollForToken,
	requestDeviceCode,
	signOut as signOutRequest,
} from '@/api/deviceAuth';

export type DeviceAuthStatus =
	| 'idle'
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
	user?: ProtectedUser;
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
	const mountedRef = useRef(true);

	const abortInFlight = useCallback(() => {
		abortRef.current?.abort();
		abortRef.current = null;
	}, []);

	// Only commit state if still mounted and this controller is the active one.
	const safeSet = useCallback(
		(controller: AbortController, next: Partial<DeviceAuthState>) => {
			if (!mountedRef.current || abortRef.current !== controller) return;
			setState((prev) => ({ ...prev, ...next }));
		},
		[],
	);

	const reset = useCallback(() => {
		abortInFlight();
		tokenRef.current = undefined;
		if (mountedRef.current) setState(INITIAL);
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
			verificationUri: code.verification_uri_complete,
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
			const user = await fetchProtectedUser(
				result.accessToken,
				controller.signal,
			);
			tokenRef.current = result.accessToken;
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
		if (token) {
			// Best-effort; server-side invalidation is verified separately.
			await signOutRequest(token);
		}
		tokenRef.current = undefined;
		if (mountedRef.current) setState(INITIAL);
	}, [abortInFlight]);

	useEffect(
		() => () => {
			mountedRef.current = false;
			abortRef.current?.abort();
			abortRef.current = null;
		},
		[],
	);

	return { ...state, start, reset, logout };
}
