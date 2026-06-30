/**
 * App auth session.
 *
 * `AppInner` consumes `useAppAuth()` for all visible login state (loading / authenticated
 * / user / buttons), decoupled from the auth implementation. Two providers supply the
 * same `AppAuthSession` shape:
 *
 *   - BetterAuthProvider  (default for every real-auth surface)
 *   - DemoAuthProvider    (OverallMode.demo — Google Docs, no-backend dev)
 *
 * Hook-rule safety: we never call adapter hooks conditionally. `AppAuthProvider` chooses
 * WHICH provider component to render; each component unconditionally calls its own hooks
 * and is only mounted when selected.
 */
import { useAtomValue } from 'jotai';
import {
	createContext,
	useContext,
	useMemo,
	type ReactNode,
} from 'react';
import { type ConsentLevel, DEFAULT_CONSENT_LEVEL } from '@/consent';
import { AccessTokenProvider } from '@/contexts/authTokenContext';
import { OverallMode, overallModeAtom } from '@/contexts/pageContext';
import { useDeviceAuth } from '@/hooks/useDeviceAuth';

export interface AppAuthSession {
	provider: 'betterauth' | 'demo';
	isLoading: boolean; // initial session/provider loading (incl. token hydration)
	isAuthorizing: boolean; // device polling in progress (NOT isLoading)
	isAuthenticated: boolean; // token present AND user loaded
	user?: {
		id?: string;
		name?: string;
		email?: string;
		loggingConsent?: ConsentLevel;
	};
	/** Resolved consent level (defaults applied) — gate analytics/logging on this. */
	loggingConsent: ConsentLevel;
	error?: Error; // provider-level error
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
	provider: 'betterauth',
	isLoading: false,
	isAuthorizing: false,
	isAuthenticated: false,
	loggingConsent: DEFAULT_CONSENT_LEVEL,
	getAccessToken: () => {
		console.warn('getAccessToken called before AppAuthProvider initialized');
		return Promise.resolve('');
	},
	login: () => Promise.resolve(),
	logout: () => Promise.resolve(),
};

const AppAuthContext = createContext<AppAuthSession>(DEFAULT_SESSION);

export const useAppAuth = (): AppAuthSession => useContext(AppAuthContext);

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
			// Hydrating a persisted token on mount is initial session load, shown via the
			// "Waiting" screen — NOT the device-code UI.
			isLoading: device.status === 'hydrating',
			isAuthorizing,
			isAuthenticated: device.status === 'success' && !!device.token,
			user: device.user,
			loggingConsent: device.user?.loggingConsent ?? DEFAULT_CONSENT_LEVEL,
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
			loggingConsent: DEFAULT_CONSENT_LEVEL,
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

/** Renders the demo provider in demo mode, Better Auth everywhere else. */
export function AppAuthProvider({ children }: { children: ReactNode }) {
	const mode = useAtomValue(overallModeAtom);

	if (mode === OverallMode.demo) {
		return <DemoAuthProvider>{children}</DemoAuthProvider>;
	}
	return <BetterAuthProvider>{children}</BetterAuthProvider>;
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
