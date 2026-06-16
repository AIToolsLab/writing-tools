/**
 * Provider-neutral auth session.
 *
 * `AppInner` consumes `useAppAuth()` instead of calling `useAuth0()` directly, so the
 * visible login state (loading / authenticated / user / buttons) is decoupled from any
 * one provider. Three adapters supply the same `AppAuthSession` shape:
 *
 *   - Auth0AuthProvider   (default everywhere; preserves current behavior)
 *   - BetterAuthProvider  (opt-in: standalone editor + ?auth=betterauth)
 *   - DemoAuthProvider    (OverallMode.demo)
 *
 * Hook-rule safety: we never call adapter hooks conditionally. `AppAuthProvider` chooses
 * WHICH provider component to render; each component unconditionally calls its own hooks
 * and is only mounted when selected.
 *
 * SCAFFOLDING: `Auth0AuthProvider`, `DemoAuthProvider`, and the `AppAuthProvider`
 * selector are temporary compatibility shims that let Auth0 and Better Auth coexist
 * during migration. Once Better Auth becomes the default, this collapses into a single
 * Better Auth-only provider and the selector/adapters can be removed.
 */
import { useAuth0 } from '@auth0/auth0-react';
import { useAtomValue } from 'jotai';
import {
	createContext,
	useContext,
	useMemo,
	type ReactNode,
} from 'react';
import { detectPlatform } from '@/api';
import { AccessTokenProvider } from '@/contexts/authTokenContext';
import { EditorContext } from '@/contexts/editorContext';
import { OverallMode, overallModeAtom } from '@/contexts/pageContext';
import { useDeviceAuth } from '@/hooks/useDeviceAuth';

export interface AppAuthSession {
	provider: 'auth0' | 'betterauth' | 'demo';
	isLoading: boolean; // initial session/provider loading only
	isAuthorizing: boolean; // device polling in progress (NOT isLoading)
	isAuthenticated: boolean; // token present AND user loaded
	user?: { name?: string; email?: string };
	error?: Error; // provider-level error (e.g. Auth0 error screen)
	authorization?: {
		status: 'pending' | 'polling' | 'error';
		userCode?: string;
		verificationUri?: string;
		error?: string;
	};
	getAccessToken: () => Promise<string>;
	login: () => Promise<void>;
	logout: () => Promise<void>;
}

const DEFAULT_SESSION: AppAuthSession = {
	provider: 'auth0',
	isLoading: false,
	isAuthorizing: false,
	isAuthenticated: false,
	getAccessToken: () => {
		console.warn('getAccessToken called before AppAuthProvider initialized');
		return Promise.resolve('');
	},
	login: () => Promise.resolve(),
	logout: () => Promise.resolve(),
};

const AppAuthContext = createContext<AppAuthSession>(DEFAULT_SESSION);

export const useAppAuth = (): AppAuthSession => useContext(AppAuthContext);

/** True only on the standalone editor with the explicit opt-in query param. */
function isBetterAuthOptIn(): boolean {
	if (typeof window === 'undefined') return false;
	if (detectPlatform() !== 'standalone') return false;
	return new URLSearchParams(window.location.search).get('auth') === 'betterauth';
}

// --- Auth0 adapter -------------------------------------------------------------

function Auth0AuthProvider({ children }: { children: ReactNode }) {
	const auth0 = useAuth0();
	const editorAPI = useContext(EditorContext);

	const session = useMemo<AppAuthSession>(
		() => ({
			provider: 'auth0',
			isLoading: auth0.isLoading,
			isAuthorizing: false,
			isAuthenticated: auth0.isAuthenticated,
			user: auth0.user
				? { name: auth0.user.name, email: auth0.user.email }
				: undefined,
			error: auth0.error,
			getAccessToken: auth0.getAccessTokenSilently,
			login: () => editorAPI.doLogin(auth0),
			logout: () => editorAPI.doLogout(auth0),
		}),
		[auth0, editorAPI],
	);

	return (
		<AppAuthContext.Provider value={session}>
			{children}
		</AppAuthContext.Provider>
	);
}

// --- Better Auth adapter -------------------------------------------------------

function BetterAuthProvider({ children }: { children: ReactNode }) {
	const device = useDeviceAuth();

	const session = useMemo<AppAuthSession>(() => {
		const isAuthorizing =
			device.status === 'pending' || device.status === 'polling';

		// authorization block is present only while a flow is active or errored;
		// idle/success are represented by omitting it.
		let authorization: AppAuthSession['authorization'];
		if (device.status === 'pending') {
			authorization = { status: 'pending' };
		} else if (device.status === 'polling') {
			authorization = {
				status: 'polling',
				userCode: device.userCode,
				verificationUri: device.verificationUri,
			};
		} else if (device.status === 'error') {
			authorization = { status: 'error', error: device.error };
		}

		return {
			provider: 'betterauth',
			isLoading: false,
			isAuthorizing,
			isAuthenticated: device.status === 'success' && !!device.token,
			user: device.user,
			authorization,
			getAccessToken: () => {
				if (device.token) return Promise.resolve(device.token);
				// Reject with an Error (lint: prefer-promise-reject-errors) that still
				// carries the `error` property authTokenContext reads.
				return Promise.reject(
					Object.assign(new Error('login_required'), {
						error: 'login_required',
					}),
				);
			},
			login: device.start,
			logout: device.logout,
		};
	}, [device]);

	return (
		<AppAuthContext.Provider value={session}>
			{children}
		</AppAuthContext.Provider>
	);
}

// --- Demo adapter --------------------------------------------------------------

function DemoAuthProvider({ children }: { children: ReactNode }) {
	const session = useMemo<AppAuthSession>(
		() => ({
			provider: 'demo',
			isLoading: false,
			isAuthorizing: false,
			isAuthenticated: true,
			getAccessToken: () => Promise.resolve('demo-access-token'),
			login: () => Promise.resolve(),
			logout: () => Promise.resolve(),
		}),
		[],
	);

	return (
		<AppAuthContext.Provider value={session}>
			{children}
		</AppAuthContext.Provider>
	);
}

// --- Selector + token bridge ---------------------------------------------------

/** Renders exactly one adapter provider by mode + opt-in. */
export function AppAuthProvider({ children }: { children: ReactNode }) {
	const mode = useAtomValue(overallModeAtom);

	if (mode === OverallMode.demo) {
		return <DemoAuthProvider>{children}</DemoAuthProvider>;
	}
	if (isBetterAuthOptIn()) {
		return <BetterAuthProvider>{children}</BetterAuthProvider>;
	}
	return <Auth0AuthProvider>{children}</Auth0AuthProvider>;
}

/** Feeds the selected session's getAccessToken into the existing token context. */
export function AppAuthTokenBridge({ children }: { children: ReactNode }) {
	const session = useAppAuth();
	return (
		<AccessTokenProvider getAccessTokenSilently={session.getAccessToken}>
			{children}
		</AccessTokenProvider>
	);
}
