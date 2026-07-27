/**
 * App auth session.
 *
 * `AppInner` consumes `useAppAuth()` for all visible login state (loading / authenticated
 * / user / buttons), decoupled from the auth implementation. Two providers supply the
 * same `AppAuthSession` shape:
 *
 *   - BetterAuthProvider  (default for every real-auth surface: Word, Google Docs)
 *   - DemoAuthProvider    (OverallMode.demo — the anonymous home-page trial). Mints
 *                          a real anonymous session; NOT a real signed-in user.
 *
 * Hook-rule safety: we never call adapter hooks conditionally. `AppAuthProvider` chooses
 * WHICH provider component to render; each component unconditionally calls its own hooks
 * and is only mounted when selected.
 */
import { useAtomValue } from 'jotai';
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	type ReactNode,
} from 'react';
import { setOpenAITokenProvider } from '@/api/openai';
import type { ConsentSnapshot } from '@/api/account';
import { type ConsentLevel, DEFAULT_CONSENT_LEVEL } from '@/consent';
import { onConsentChangeFromOtherTab } from '@/consentSync';
import { AccessTokenProvider } from '@/contexts/authTokenContext';
import { OverallMode, overallModeAtom } from '@/contexts/pageContext';
import { useAnonymousAuth } from '@/hooks/useAnonymousAuth';
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
		/** Beta access decision, computed server-side (see backend userAllowlist.ts). */
		isAllowed?: boolean;
		/** Demo/anonymous session — account surfaces steer these to real sign-in. */
		isAnonymous?: boolean;
		/** When consent was last set (ISO string), or null if never. */
		consentUpdatedAt?: string | null;
	};
	/** Resolved consent level (defaults applied) — gate analytics/logging on this. */
	loggingConsent: ConsentLevel;
	/**
	 * Whether the user has ever set a consent level. False until they do (a fresh
	 * real user has consentUpdatedAt === null); the onboarding consent gate shows
	 * once while this is false. Always true for demo/anonymous (consent set on
	 * create) and never blocks no-auth modes.
	 */
	hasSetConsent: boolean;
	error?: Error; // provider-level error
	authorization?: {
		status: 'pending' | 'polling' | 'error';
		userCode?: string;
		verificationUri?: string;
		/** Epoch ms when the user code expires; drives the sign-in countdown. */
		expiresAt?: number;
		error?: string;
	};
	getAccessToken: () => Promise<string>;
	login: () => Promise<void>;
	/**
	 * Abort an in-flight device sign-in and return to the idle login screen.
	 * Abandoned attempts left polling forever are what produced overlapping
	 * flows (and the state_mismatch artifacts) — always render a Cancel while
	 * `isAuthorizing` so the user has a clean way out.
	 */
	cancelLogin: () => void;
	/**
	 * Re-fetch the signed-in user without a re-login, so a server-side change to
	 * the user record (consent now; usage/key on the future account surface)
	 * reflects in `user`/`hasSetConsent` live. No-op for the demo provider.
	 */
	refreshUser: () => Promise<void>;
	/** Apply the authoritative result of a consent update without re-fetching. */
	applyConsentSnapshot: (snapshot: ConsentSnapshot) => void;
	/** Temporarily use no logging while another tab's update is re-fetched. */
	invalidateConsent: () => void;
	logout: () => Promise<void>;
}

const DEFAULT_SESSION: AppAuthSession = {
	provider: 'betterauth',
	isLoading: false,
	isAuthorizing: false,
	isAuthenticated: false,
	loggingConsent: DEFAULT_CONSENT_LEVEL,
	hasSetConsent: false,
	getAccessToken: () => {
		console.warn(
			'getAccessToken called before AppAuthProvider initialized',
		);
		return Promise.resolve('');
	},
	login: () => Promise.resolve(),
	cancelLogin: () => {},
	refreshUser: () => Promise.resolve(),
	applyConsentSnapshot: () => {},
	invalidateConsent: () => {},
	logout: () => Promise.resolve(),
};

const AppAuthContext = createContext<AppAuthSession>(DEFAULT_SESSION);

export const useAppAuth = (): AppAuthSession => useContext(AppAuthContext);

// --- Better Auth adapter -------------------------------------------------------

function BetterAuthProvider({ children }: { children: ReactNode }) {
	const device = useDeviceAuth();
	const { refreshUser, invalidateConsent } = device;

	// Cross-tab consent propagation. A consent change on the standalone account page
	// (a separate tab) would otherwise leave this tab's session — and thus the PostHog
	// bridge and useLog — logging at the pre-change level. Refresh when another tab
	// broadcasts a change. refreshUser no-ops when there's no active session.
	useEffect(
		() =>
			onConsentChangeFromOtherTab(() => {
				invalidateConsent();
				void refreshUser();
			}),
		[invalidateConsent, refreshUser],
	);

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
				expiresAt: device.expiresAt,
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
			loggingConsent:
				device.user?.loggingConsent ?? DEFAULT_CONSENT_LEVEL,
			// null (or an unauthenticated session) → false → the consent gate shows.
			hasSetConsent: !!device.user?.consentUpdatedAt,
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
			cancelLogin: device.reset,
			refreshUser: device.refreshUser,
			applyConsentSnapshot: device.applyConsentSnapshot,
			invalidateConsent: device.invalidateConsent,
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
	const anon = useAnonymousAuth();

	const session = useMemo<AppAuthSession>(
		() => ({
			provider: 'demo',
			// The demo editor renders immediately — the anonymous session is
			// established in the background (getAccessToken awaits it), so there's no
			// "Waiting for authentication" wall for a public trial.
			isLoading: false,
			isAuthorizing: false,
			isAuthenticated: anon.status === 'success' && !!anon.token,
			user: anon.user,
			// Anonymous users are created at full consent server-side; reflect that
			// once the session loads. The fallback only applies during the brief
			// pre-load window, where nothing is logged (isAuthenticated is false).
			loggingConsent: anon.user?.loggingConsent ?? DEFAULT_CONSENT_LEVEL,
			// Anonymous users are created at full consent server-side, so they've
			// effectively "set" it — never prompt the demo with the consent gate.
			hasSetConsent: true,
			error:
				anon.status === 'error'
					? new Error(anon.error ?? 'Demo sign-in failed')
					: undefined,
			getAccessToken: anon.getAccessToken,
			login: () => Promise.resolve(),
			cancelLogin: () => {},
			refreshUser: () => Promise.resolve(),
			applyConsentSnapshot: () => {},
			invalidateConsent: () => {},
			logout: () => Promise.resolve(),
		}),
		[anon],
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

/**
 * Feeds the selected session's getAccessToken into the existing token context, and
 * into the OpenAI client — the model proxy is authenticated and meters spend per
 * user, but the client is a module singleton used outside React, so it takes the
 * token getter by installation rather than through context.
 */
export function AppAuthTokenBridge({ children }: { children: ReactNode }) {
	const session = useAppAuth();

	useEffect(() => {
		setOpenAITokenProvider(session.getAccessToken);
	}, [session.getAccessToken]);

	return (
		<AccessTokenProvider getAccessTokenSilently={session.getAccessToken}>
			{children}
		</AccessTokenProvider>
	);
}
