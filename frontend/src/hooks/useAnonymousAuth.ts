/**
 * React hook establishing a demo user's anonymous Better Auth session.
 *
 * On mount it reuses a persisted anonymous token when still valid, otherwise mints a
 * fresh anonymous session (signIn.anonymous). Unlike the interactive device flow
 * (useDeviceAuth) there's nothing for the user to approve — the session is created
 * silently in the background, so the demo editor renders immediately and never shows
 * an auth wall. `getAccessToken` returns a promise chained to that background work,
 * so a model/log request that fires before the token lands simply waits for it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { signInAnonymous } from '@/api/anonymousAuth';
import {
	clearDemoToken,
	loadDemoToken,
	persistDemoToken,
} from '@/api/authTokenStore';
import { fetchUserInfo, type UserInfo } from '@/api/deviceAuth';

export type AnonymousAuthStatus = 'loading' | 'success' | 'error';

export interface AnonymousAuthState {
	status: AnonymousAuthStatus;
	/** Present on status==='success'. Held in memory; also persisted for reuse. */
	token?: string;
	user?: UserInfo;
	error?: string;
}

export interface UseAnonymousAuth extends AnonymousAuthState {
	/** Resolves once the anonymous session is ready; rejects if it never establishes. */
	getAccessToken: () => Promise<string>;
}

export function useAnonymousAuth(): UseAnonymousAuth {
	const [state, setState] = useState<AnonymousAuthState>({
		status: 'loading',
	});
	// The in-flight (or settled) token acquisition. getAccessToken awaits this so a
	// request firing before the session lands waits rather than failing.
	const tokenPromiseRef = useRef<Promise<string> | null>(null);

	useEffect(() => {
		const controller = new AbortController();

		const establish = async (): Promise<string> => {
			// Reuse a persisted anonymous session when its token still validates.
			const stored = loadDemoToken();
			if (stored) {
				try {
					const user = await fetchUserInfo(stored, controller.signal);
					if (!controller.signal.aborted) {
						setState({ status: 'success', token: stored, user });
					}
					return stored;
				} catch {
					if (controller.signal.aborted) {
						throw new DOMException('Aborted', 'AbortError');
					}
					clearDemoToken(); // stale/invalid — mint a fresh one below
				}
			}

			const token = await signInAnonymous(controller.signal);
			if (controller.signal.aborted) {
				throw new DOMException('Aborted', 'AbortError');
			}
			persistDemoToken(token);
			const user = await fetchUserInfo(token, controller.signal);
			if (!controller.signal.aborted) {
				setState({ status: 'success', token, user });
			}
			return token;
		};

		const promise = establish();
		tokenPromiseRef.current = promise;
		promise.catch((e) => {
			if (controller.signal.aborted) return;
			setState({ status: 'error', error: (e as Error).message });
		});

		return () => controller.abort();
	}, []);

	const getAccessToken = useCallback((): Promise<string> => {
		return (
			tokenPromiseRef.current ??
			Promise.reject(
				Object.assign(new Error('login_required'), {
					error: 'login_required',
				}),
			)
		);
	}, []);

	return { ...state, getAccessToken };
}
