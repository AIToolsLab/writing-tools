import {
	PostHogProvider,
	PostHogErrorBoundary,
	usePostHog,
} from '@posthog/react';
import { useWindowSize } from '@react-hook/window-size/throttled';
import { useAtomValue } from 'jotai';
import { useEffect, useState } from 'react';
import { consentRank } from '@/consent';
import {
	AppAuthProvider,
	AppAuthTokenBridge,
	useAppAuth,
} from '@/contexts/appAuthContext';
import { useAccessToken } from '@/contexts/authTokenContext';
import ChatContextWrapper from '@/contexts/chatContext';
import { DocBriefProvider } from '@/contexts/docBriefContext';
import {
	OverallMode,
	overallModeAtom,
	PageName,
	pageNameAtom,
} from '@/contexts/pageContext';
import { OnboardingCarousel } from '../carousel/OnboardingCarousel';
import { resolvePage } from '../registry';
import classes from './styles.module.css';
import Navbar from '@/components/navbar';
import { Reshaped, Button } from 'reshaped';
import 'reshaped/themes/slate/theme.css';

// PostHog configuration - project token is safe to commit publicly
const POSTHOG_KEY = 'phc_p3Br0zRnw7PdTVpdNI92vvBTWcBBY0jvkHO8dNvkCTl';
const POSTHOG_HOST = 'https://e.thoughtful-ai.com/';
const POSTHOG_ENABLED = true;

// Live countdown to the device code's expiry. Codes are short-lived (minutes) and
// the user only used to find out at Approve time — show the clock up front.
function CodeCountdown({ expiresAt }: { expiresAt?: number }) {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(timer);
	}, []);
	if (!expiresAt) return null;

	const remaining = Math.max(0, Math.round((expiresAt - now) / 1000));
	if (remaining === 0) {
		// The polling loop surfaces the terminal 'expired' error within one poll
		// interval (~5s); this keeps the countdown honest in that gap.
		return <p style={{ margin: '0.25rem 0' }}>Code expired.</p>;
	}
	const m = Math.floor(remaining / 60);
	const s = String(remaining % 60).padStart(2, '0');
	return (
		<p style={{ margin: '0.25rem 0', opacity: 0.75 }}>
			Code expires in {m}:{s}
		</p>
	);
}

// Device-flow status surfaced during Better Auth sign-in. Shows the user code, a
// link that opens the approval page in a new window/tab, the expiry countdown, and
// a Cancel that aborts the in-flight flow, so an abandoned attempt stops polling
// immediately instead of running until the code expires.
// Rendered inside the not-logged-in screen, NOT gated by the isLoading "Waiting" screen.
function DeviceAuthStatus({
	authorization,
	onCancel,
}: {
	authorization?: {
		status: 'pending' | 'polling' | 'error';
		userCode?: string;
		verificationUri?: string;
		expiresAt?: number;
		error?: string;
	};
	onCancel?: () => void;
}) {
	if (!authorization) return null;

	const cancelButton = onCancel ? (
		<Button variant="ghost" size="small" onClick={onCancel}>
			Cancel
		</Button>
	) : null;

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
				{cancelButton}
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
			<CodeCountdown expiresAt={authorization.expiresAt} />
			{authorization.verificationUri ? (
				<div style={{ margin: '0.25rem 0 0.75rem' }}>
					<Button
						href={authorization.verificationUri}
						attributes={{ target: '_blank', rel: 'noopener' }}
						color="primary"
						variant="outline"
						size="small"
					>
						Open approval page
					</Button>
				</div>
			) : null}
			<p>Open the approval page and enter the code above to continue.</p>
			{cancelButton}
		</div>
	);
}

function AppInner() {
	const mode = useAtomValue(overallModeAtom);
	const noAuthMode = mode !== OverallMode.full;
	const session = useAppAuth();
	const {
		isLoading,
		isAuthorizing,
		error,
		isAuthenticated,
		user,
		authorization,
	} = session;
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

						<DeviceAuthStatus
							authorization={authorization}
							onCancel={session.cancelLogin}
						/>

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

	// Beta access is decided server-side (backend userAllowlist.ts) and surfaced on
	// the session as `isAllowed`; demo/no-auth modes are never gated here.
	const isUserAllowed = noAuthMode || user?.isAllowed === true;

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

	// Which page renders is the registry's call, not a switch here — see
	// pages/registry.tsx. resolvePage also handles a stored selection that is no
	// longer visible (a lab page whose flag was turned off) by falling back to the
	// default page; the navbar highlights the same resolved page, so the strip and
	// the content can't disagree.
	function getComponent(pageName: PageName): React.JSX.Element | null {
		return resolvePage(pageName)?.render() ?? null;
	}

	return (
		<div className={classes.appShell}>
			<Navbar />
			<div className={classes.appBody}>{getComponent(page)}</div>
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
			<footer className={classes.footer}>
				<a
					href="https://thoughtful-ai.com/"
					className={classes.ibtn}
					target="_blank"
					rel="noopener noreferrer"
				>
					Thoughtful AI Lab
				</a>
				{' · '}
				<a
					href="https://www.nsf.gov/awardsearch/show-award/?AWD_ID=2246145"
					className={classes.ibtn}
					target="_blank"
					rel="noopener noreferrer"
					title="This material is based upon work supported by the U.S. National Science Foundation under Grant No. 2246145. Any opinions, findings, and conclusions or recommendations expressed are those of the authors and do not necessarily reflect the views of the National Science Foundation."
				>
					NSF #2246145
				</a>
			</footer>
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
}): React.JSX.Element {
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
			isAuthenticated &&
			consentRank(loggingConsent) >= consentRank('usage');

		// Require a stable id before opting in, so we never capture untethered
		// anonymous events that can't be tied to a deletable account identity.
		if (analyticsAllowed && user?.id) {
			posthog.identify(user.id);
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
							{/* The document's brief is shared by every page, so it
							    is loaded once here rather than per page. Inside the
							    auth providers because the section it feeds logs
							    edits. */}
							<DocBriefProvider>
								<AppInner />
							</DocBriefProvider>
						</AppAuthTokenBridge>
					</AppAuthProvider>
				</Reshaped>
			</ChatContextWrapper>
		</AppWithProviders>
	);
}
