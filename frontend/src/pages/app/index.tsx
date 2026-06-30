import {
	PostHogProvider,
	PostHogErrorBoundary,
	usePostHog,
} from '@posthog/react';
import { useWindowSize } from '@react-hook/window-size/throttled';
import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { consentRank } from '@/consent';
import { CgGoogle } from 'react-icons/cg';
import {
	AppAuthProvider,
	AppAuthTokenBridge,
	useAppAuth,
} from '@/contexts/appAuthContext';
import { useAccessToken } from '@/contexts/authTokenContext';
import ChatContextWrapper from '@/contexts/chatContext';
import {
	OverallMode,
	overallModeAtom,
	PageName,
	pageNameAtom,
} from '@/contexts/pageContext';
import { OnboardingCarousel } from '../carousel/OnboardingCarousel';
import Chat from '../chat';
import Draft from '../draft';
import Revise from '../revise';
import classes from './styles.module.css';
import Navbar from '@/components/navbar';
import { Reshaped, Button } from 'reshaped';
import 'reshaped/themes/slate/theme.css';

// PostHog configuration - project token is safe to commit publicly
const POSTHOG_KEY = 'phc_p3Br0zRnw7PdTVpdNI92vvBTWcBBY0jvkHO8dNvkCTl';
const POSTHOG_HOST = 'https://e.thoughtful-ai.com/';
const POSTHOG_ENABLED = true;

// Device-flow status surfaced during Better Auth sign-in. Shows the user code and a
// button that opens the approval page in a new window/tab.
// Rendered inside the not-logged-in screen, NOT gated by the isLoading "Waiting" screen.
function DeviceAuthStatus({
	authorization,
}: {
	authorization?: {
		status: 'pending' | 'polling' | 'error';
		userCode?: string;
		verificationUri?: string;
		error?: string;
	};
}) {
	if (!authorization) return null;

	if (authorization.status === 'error') {
		return (
			<div className={classes.loginInfoContainer}>
				<p>Sign-in failed: {authorization.error}</p>
			</div>
		);
	}

	if (authorization.status === 'pending') {
		return (
			<div className={classes.loginInfoContainer}>
				<p>Requesting device code…</p>
			</div>
		);
	}

	// polling
	return (
		<div
			className={classes.loginInfoContainer}
			style={{
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				textAlign: 'center',
			}}
		>
			<p style={{ margin: 0 }}>Your code:</p>
			<p
				style={{
					fontFamily: 'monospace',
					fontSize: '1.35rem',
					fontWeight: 700,
					letterSpacing: '0.12em',
					margin: '0.25rem 0 0.75rem',
				}}
			>
				{authorization.userCode}
			</p>
			{authorization.verificationUri ? (
				<p style={{ margin: '0.25rem 0 0.75rem' }}>
					<a href={authorization.verificationUri} target="_blank" rel="noopener">Open approval page</a>
				</p>
			) : null}
			<p>Open the approval page and enter the code above to continue.</p>
		</div>
	);
}

function AppInner() {
	const mode = useAtomValue(overallModeAtom);
	const noAuthMode = mode !== OverallMode.full;
	const session = useAppAuth();
	const { isLoading, isAuthorizing, error, isAuthenticated, user, authorization } =
		session;
	const [width, _height] = useWindowSize();
	const page = useAtomValue(pageNameAtom);
	const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() => {
		return localStorage.getItem('hasCompletedOnboarding') === 'true';
	});
	const { authErrorType } = useAccessToken();

	// Detect if the user is using the latest version of Office
	// https://learn.microsoft.com/en-us/office/dev/add-ins/develop/support-ie-11?tabs=ie
	function isOfficeLatest(): boolean {
		if (navigator.userAgent.indexOf('Trident') !== -1) {
			/*
				Trident is the webview in use. Do one of the following:
				1. Provide an alternate add-in experience that doesn't use any of the HTML5
				features that aren't supported in Trident (Internet Explorer 11).
				2. Enable the add-in to gracefully fail by adding a message to the UI that
				says something similar to:
				"This add-in won't run in your version of Office. Please upgrade either to
				perpetual Office 2021 (or later) or to a Microsoft 365 account."
			*/
			return false;
		} else if (navigator.userAgent.indexOf('Edge') !== -1) {
			/*
				EdgeHTML is the browser in use. Do one of the following:
				1. Provide an alternate add-in experience that's supported in EdgeHTML (Microsoft Edge Legacy).
				2. Enable the add-in to gracefully fail by adding a message to the UI that
				says something similar to:
				"This add-in won't run in your version of Office. Please upgrade either to
				perpetual Office 2021 (or later) or to a Microsoft 365 account."
			*/
			return false;
		} else {
			/*
				A webview other than Trident or EdgeHTML is in use.
				Provide a full-featured version of the add-in here.
			*/
			return true;
		}
	}

	if (isLoading)
		return (
			<div className={classes.loadingContainer}>
				<div>Waiting for authentication</div>
				<div className={classes.spinnerWrapper}>
					<div className={classes.loader}></div>
				</div>
			</div>
		);
	if (error)
		return (
			<div className={classes.container}>
				<p>Oops... {error.message}</p>
				<Button
					color="neutral"
					variant="solid"
					onClick={() => {
						window.location.reload();
					}}
				>
					Reload
				</Button>
			</div>
		);

	if (!noAuthMode && (!isAuthenticated || !user)) {
		return (
			<div>
				{!hasCompletedOnboarding ? (
					<OnboardingCarousel
						onComplete={() => {
							setHasCompletedOnboarding(true);
							localStorage.setItem(
								'hasCompletedOnboarding',
								'true',
							);
						}}
					/>
				) : (
					<div className={classes.loginContainer}>
						<h3>Not logged in yet?</h3>
						<Button
							color="primary"
							variant="solid"
							size="large"
							loading={isAuthorizing}
							onClick={() => {
								void session.login();
							}}
						>
							Login
						</Button>

						<DeviceAuthStatus authorization={authorization} />

						<div className={classes.loginInfoContainer}>
							<p>
								<strong>Note</strong>: login is required since
								this is a closed trial for now.
							</p>
						</div>

						<div className={classes.signupBtnCtnr}>
							Click
							<a
								href="https://tinyurl.com/3dfrujnz"
								className={classes.ibtn}
								target="_blank"
							>
								here
							</a>
							to sign up for the study if interested.
						</div>

						<hr />

						<p>Sign in with Google</p>
						<div className={classes.authProviderIconContainer}>
							<CgGoogle className={classes.authProviderIcon} />
						</div>

						<div
							className={classes.widthAlert}
							style={{
								visibility: width < 400 ? 'visible' : 'hidden',
							}}
						>
							For best experience, please expand the sidebar by
							dragging the splitter.
						</div>

						<div
							className={classes.versionAlert}
							style={{
								visibility: !isOfficeLatest()
									? 'visible'
									: 'hidden',
							}}
						>
							This add-in may not run correctly in your version of
							Office. Please upgrade either to perpetual Office
							2021 (or later) or to a Microsoft 365 account.
						</div>
					</div>
				)}
			</div>
		);
	}

	// For the beta, only allow Calvin email addresses and example test user
	const isUserAllowed =
		noAuthMode ||
		user?.email?.endsWith('@calvin.edu') ||
		user?.email === 'example-user@textfocals.com';

	if (!noAuthMode && !isUserAllowed) {
		return (
			<div className={classes.notAllowedContainer}>
				<p className={classes.notAllowedTitle}>
					Sorry, you are not allowed to access this page.
				</p>
				<hr />
				<p>
					For the purpose of the beta study, we are limiting access to
					Calvin email addresses only.
				</p>
				<p>
					<a
						href="https://thoughtful-ai.com/"
						className={classes.ibtn}
						target="_blank"
					>
						Contact the developer
					</a>
					if you are interested in participating in the study.
				</p>
				<hr />
				<Button
					color="neutral"
					variant="outline"
					onClick={() => {
						console.log('origin', window.location.origin);
						void session.logout();
					}}
				>
					Sign Out
				</Button>
			</div>
		);
	}

	function getComponent(pageName: PageName): JSX.Element | null {
		switch (pageName) {
			case PageName.Revise:
				return <Revise />;
			case PageName.Chat:
				return <Chat />;
			case PageName.Draft:
				return <Draft />;
		}
		return null;
	}

	return (
		<div className="h-full flex flex-col overflow-hidden">
			<Navbar />
			<div className="flex-1 flex flex-col overflow-y-auto">
				{getComponent(page)}
			</div>
			{!noAuthMode && user ? (
				<div className={classes.container}>
					<div className={classes.profileContainer}>
						<div className={classes.userNameContainer}>
							User: {user.name}
						</div>
					</div>
					{authErrorType !== null && (
						<Button
							color="primary"
							variant="solid"
							onClick={() => {
								// do login again
								void session.login();
							}}
						>
							Reauthorize
						</Button>
					)}
					<Button
						color="neutral"
						variant="outline"
						onClick={() => {
							console.log('origin', window.location.origin);
							void session.logout();
						}}
					>
						Sign Out
					</Button>
				</div>
			) : null}
		</div>
	);
}

function PostHogErrorFallback() {
	return (
		<div style={{ padding: '20px', textAlign: 'center' }}>
			<h2>Something went wrong</h2>
			<p>An error has been logged. Please refresh the page.</p>
			<Button
				color="primary"
				variant="solid"
				onClick={() => window.location.reload()}
			>
				Refresh
			</Button>
		</div>
	);
}

function AppWithProviders({
	children,
}: {
	children: React.ReactNode;
}): JSX.Element {
	console.log('PostHog enabled:', POSTHOG_ENABLED);
	// Wrap with PostHog if enabled, otherwise just render children
	if (!POSTHOG_ENABLED) {
		return <>{children}</>;
	}

	return (
		<PostHogProvider
			apiKey={POSTHOG_KEY}
			options={{
				api_host: POSTHOG_HOST,
				capture_exceptions: true,
				// Capture nothing until we know the user's consent level. The
				// PostHogConsentBridge opts in (and identifies) once a session with
				// consent >= 'usage' loads. Until then — and at level 'none' — PostHog
				// stays opted out. NOTE: opt-out also suppresses capture_exceptions, so
				// level 'none' is fully silent (no crash reports either).
				opt_out_capturing_by_default: true,
			}}
		>
			<PostHogErrorBoundary fallback={<PostHogErrorFallback />}>
				{children}
			</PostHogErrorBoundary>
		</PostHogProvider>
	);
}

/**
 * Bridges logging consent → PostHog. Mounted inside both PostHogProvider and
 * AppAuthProvider. Opts capturing in and identifies the user (by stable Better
 * Auth id, matching server-side log keying + deletion) once an authenticated
 * session at consent >= 'usage' loads; otherwise stays opted out and clears any
 * prior identity. Renders nothing.
 */
function PostHogConsentBridge(): null {
	const posthog = usePostHog();
	const { isAuthenticated, loggingConsent, user } = useAppAuth();

	useEffect(() => {
		if (!posthog) return;
		const analyticsAllowed =
			isAuthenticated && consentRank(loggingConsent) >= consentRank('usage');

		if (analyticsAllowed) {
			if (user?.id) posthog.identify(user.id);
			posthog.opt_in_capturing();
		} else {
			posthog.opt_out_capturing();
			posthog.reset(); // drop any identity captured under a prior session
		}
	}, [posthog, isAuthenticated, loggingConsent, user?.id]);

	return null;
}

export default function App() {
	// AppAuthProvider selects the active session (Better Auth by default, Demo in demo
	// mode); AppAuthTokenBridge feeds the chosen session's getAccessToken into the token
	// context.
	return (
		<AppWithProviders>
			<ChatContextWrapper>
				<Reshaped theme="slate">
					<AppAuthProvider>
						<PostHogConsentBridge />
						<AppAuthTokenBridge>
							<AppInner />
						</AppAuthTokenBridge>
					</AppAuthProvider>
				</Reshaped>
			</ChatContextWrapper>
		</AppWithProviders>
	);
}
