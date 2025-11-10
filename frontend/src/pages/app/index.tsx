import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { useWindowSize } from '@react-hook/window-size/throttled';
import { useAtomValue } from 'jotai';
import { useContext, useState } from 'react';
import { CgFacebook, CgGoogle, CgMicrosoft } from 'react-icons/cg';
import {
	AccessTokenProvider,
	useAccessToken,
} from '@/contexts/authTokenContext';
import ChatContextWrapper from '@/contexts/chatContext';
import { EditorContext } from '@/contexts/editorContext';
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
import "reshaped/themes/slate/theme.css";

function AppInner() {
	const mode = useAtomValue(overallModeAtom);
	const noAuthMode = mode !== OverallMode.full;
	const auth0Client = useAuth0();
	const { isLoading, error, isAuthenticated, user } = auth0Client;
	const [width, _height] = useWindowSize();
	const page = useAtomValue(pageNameAtom);
	const editorAPI = useContext(EditorContext);
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
							onClick={() => {
								void editorAPI.doLogin(auth0Client);
							}}
						>
							Login
						</Button>

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

						<p>Available Auth Providers</p>
						<div className={classes.authProviderIconContainer}>
							<CgGoogle className={classes.authProviderIcon} />
							<CgMicrosoft className={classes.authProviderIcon} />
							<CgFacebook className={classes.authProviderIcon} />
						</div>

						<div
							className={classes.widthAlert}
							style={{
								visibility: width < 400 ? 'visible' : 'hidden',
							}}
						>
							For best experience please expand the sidebar by
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
						editorAPI.doLogout(auth0Client);
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
		<div className="h-full flex flex-col">
			<Navbar />
			<div className="flex-1 flex flex-col">
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
								void editorAPI.doLogin(auth0Client);
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
							editorAPI.doLogout(auth0Client);
						}}
					>
						Sign Out
					</Button>
				</div>
			) : null}
		</div>
	);
}

export default function App() {
	// If demo mode is enabled, we use a mock access token provider
	const mode = useAtomValue(overallModeAtom);
	const needAuth = mode === OverallMode.full;

	const AccessTokenProvider = needAuth
		? Auth0AccessTokenProviderWrapper
		: DemoAccessTokenProviderWrapper;

	return (
		<ChatContextWrapper>
			<Reshaped theme="slate">

				<Auth0Provider
					domain={process.env.AUTH0_DOMAIN!}
					clientId={process.env.AUTH0_CLIENT_ID!}
					cacheLocation="localstorage"
					useRefreshTokens={true}
					useRefreshTokensFallback={true}
					authorizationParams={{
						redirect_uri: `${window.location.origin}/popup.html`,
						scope: 'openid profile email read:posts',
						audience: 'textfocals.com',
						leeway: 10,
					}}
				>
					<AccessTokenProvider>
						<AppInner />
					</AccessTokenProvider>
				</Auth0Provider>
			</Reshaped>
		</ChatContextWrapper>
	);
}

function DemoAccessTokenProviderWrapper({
	children,
}: {
	children: React.ReactNode;
}) {
	const getAccessTokenSilently = () => {
		// Simulate a token retrieval for demo purposes
		return Promise.resolve('demo-access-token');
	};
	return (
		<AccessTokenProvider getAccessTokenSilently={getAccessTokenSilently}>
			{children}
		</AccessTokenProvider>
	);
}

function Auth0AccessTokenProviderWrapper({
	children,
}: {
	children: React.ReactNode;
}) {
	const { getAccessTokenSilently } = useAuth0();
	return (
		<AccessTokenProvider getAccessTokenSilently={getAccessTokenSilently}>
			{children}
		</AccessTokenProvider>
	);
}
