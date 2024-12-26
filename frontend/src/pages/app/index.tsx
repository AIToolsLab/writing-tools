import { useContext, useRef, useEffect, useState } from 'react';
import { pingServer } from '@/api';

import { CgFacebook, CgGoogle, CgMicrosoft } from 'react-icons/cg';
import { useWindowSize } from '@react-hook/window-size/throttled';

import { useAuth0, Auth0Provider } from '@auth0/auth0-react';

import PageContextWrapper, { PageName, PageContext } from '@/contexts/pageContext';
import UserContextWrapper from '@/contexts/userContext';
import ChatContextWrapper from '@/contexts/chatContext';

import classes from './styles.module.css';

import Layout from '@/components/layout';

import Revise from '../revise';
import SearchBar from '../searchbar';
import Chat from '../chat';
import Draft from '../draft';
import { wordEditorAPI } from '@/api/wordEditorAPI';
import { OnboardingCarousel } from '../carousel/OnboardingCarousel';

export interface HomeProps {
	editorAPI: EditorAPI;
}

function usePingServer() {

	const pingInterval = useRef<NodeJS.Timeout>();

	// 2 minutes
	const PINGINT: number = 2 * 60 * 1000;

	useEffect(() => {
		function doPing() {
			// eslint-disable-next-line no-console
			console.log(`Pinging server at ${new Date().toISOString()}`);

			pingServer().then(() => {
				// eslint-disable-next-line no-console
				console.log('Warming up server');
			}).catch(error => {
				// eslint-disable-next-line no-console
				console.warn('Ping failed:', error);
			});
		}

		// First ping the server immediately
		doPing();
		// Then set up the interval
		pingInterval.current = setInterval(doPing, PINGINT);

		return () => {
			if (pingInterval.current) {
				clearInterval(pingInterval.current);
			}
		};
	}, []);
}

function AppInner({ editorAPI }: HomeProps) {
	const auth0Client = useAuth0();
	const { isLoading, error, isAuthenticated, user } = auth0Client;
	const [width, _height] = useWindowSize();
	const { page } = useContext(PageContext);
	const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(() => {
		return localStorage.getItem('hasCompletedOnboarding') === 'true';
	});


	usePingServer();

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
		}
		else if (navigator.userAgent.indexOf('Edge') !== -1) {
			/*
				EdgeHTML is the browser in use. Do one of the following:
        1. Provide an alternate add-in experience that's supported in EdgeHTML (Microsoft Edge Legacy).
        2. Enable the add-in to gracefully fail by adding a message to the UI that
        says something similar to:
        "This add-in won't run in your version of Office. Please upgrade either to
        perpetual Office 2021 (or later) or to a Microsoft 365 account."
      */
			return false;
		}
		else {
			/*
        A webview other than Trident or EdgeHTML is in use.
        Provide a full-featured version of the add-in here.
      */
			return true;
		}
	}

	if (isLoading) return (
		<div className={ classes.loadingContainer }>
			<div>Waiting for authentication</div>
			<div className={ classes.spinnerWrapper }>
				<div className={ classes.loader }></div>
			</div>
		</div>
	);
	if (error) return (
		<div className={ classes.container }>
			<p>Oops... { error.message }</p>
			<button
				className={ classes.logoutButton }
				onClick={ () => {
				window.location.reload();
				} }
			>
				Reload
			</button>
		</div>
	);

	if (!isAuthenticated || !user) {
		return (
			<div>
				{ !hasCompletedOnboarding ? (
					<OnboardingCarousel
						onComplete={ () => {
							setHasCompletedOnboarding(true);
							localStorage.setItem('hasCompletedOnboarding', 'true');
						} }
					/>
				) : (
					<div className={ classes.loginContainer }>
						<h3>Not logged in yet?</h3>
						<button
							className={ classes.loginButton }
							onClick={ async () => {
								await editorAPI.doLogin(auth0Client);
							} }
						>
							<p>Login</p>
						</button>

						<div className={ classes.loginInfoContainer }>
							<p><strong>Note</strong>: the reason for Login is because it is a closed trial of study for now</p>
						</div>

						<div className={ classes.signupBtnCtnr }>
							Click
							<a href="https://tinyurl.com/3dfrujnz" className={ classes.ibtn } target="_blank">
								here
							</a>
							to sign up for the study if interested.
						</div>


						<hr />

						<p>Available Auth Providers</p>
						<div className={ classes.authProviderIconContainer }>
							<CgGoogle className={ classes.authProviderIcon } />
							<CgMicrosoft className={ classes.authProviderIcon } />
							<CgFacebook className={ classes.authProviderIcon } />
						</div>

						<div className={ classes.widthAlert } style={ { visibility: width < 400 ? 'visible' : 'hidden' } }>
							For best experience please expand the sidebar by dragging the splitter.
						</div>

						<div className={ classes.versionAlert } style={ { visibility: !isOfficeLatest() ? 'visible' : 'hidden' } }>
							This add-in may not run correctly in your version of Office. Please upgrade either to
							perpetual Office 2021 (or later) or to a Microsoft 365 account.
						</div>
					</div>
				) }
			</div>
		);
	}

	// For the beta, only allow Calvin email addresses and example test user
	const isUserAllowed = user.email?.endsWith('@calvin.edu') || user.email === 'example-user@textfocals.com';

	if (!isUserAllowed) {
		return (
			<div className={ classes.notAllowedContainer }>
				<p className={ classes.notAllowedTitle }>Sorry, you are not allowed to access this page.</p>
				<hr />
				<p>For the purpose of the beta study, we are limiting access to Calvin email addresses only.</p>
				<p>
					<a href="https://thoughtful-ai.com/" className={ classes.ibtn } target="_blank">Contact the developer</a>
					if you are interested in participating in the study.
				</p>
				<hr />
				<button
					className={ classes.logoutButton }
					onClick={ () => {
						// eslint-disable-next-line no-console
						console.log('origin', window.location.origin);
						editorAPI.doLogout(auth0Client);
					} }
				>
					LogOut
				</button>
			</div>
		);
	}

	function getComponent(pageName: PageName): JSX.Element | null {
		switch (pageName) {
			case PageName.Revise:
				return <Revise editorAPI={ editorAPI } />;
			case PageName.SearchBar:
				return <SearchBar />;
			case PageName.Chat:
				return <Chat />;
			case PageName.Draft:
				return <Draft editorAPI={ editorAPI } />;
		}
		return null;
	}


	return (
		<Layout>
			<div className={ classes.container }>
				<div className={ classes.profileContainer }>
					<div className={ classes.profilePicContainer }>
						<img
							src={ user && user.picture }
							alt="Profile"
							className={ classes.profilePic }
							referrerPolicy="no-referrer"
						/>
					</div>
					<div className={ classes.userNameContainer }>
						User: { user!.name }
					</div>
				</div>
				<button
					className={ classes.logoutButton }
					onClick={ () => {
					// eslint-disable-next-line no-console
					console.log('origin', window.location.origin);
					editorAPI.doLogout(auth0Client);
				} }
				>
					LogOut
				</button>
			</div>
			{ getComponent(page) }
		</Layout>
		);
}

export default function App({ editorAPI }: HomeProps) {
	if (!editorAPI) {
		editorAPI = wordEditorAPI;
	}
	return (
		<ChatContextWrapper>
			<UserContextWrapper>
				<PageContextWrapper>
				<Auth0Provider
						domain={ process.env.AUTH0_DOMAIN! }
						clientId={ process.env.AUTH0_CLIENT_ID! }
						cacheLocation='localstorage'
						useRefreshTokens={ true }
						authorizationParams= { {
							// eslint-disable-next-line camelcase
							redirect_uri: `${window.location.origin}/popup.html`,
							scope: 'openid profile email read:posts',
							audience: 'textfocals.com',
							leeway: 10
						} }
					>		<AppInner editorAPI={ editorAPI } />
				</Auth0Provider>
				</PageContextWrapper>
			</UserContextWrapper>
		</ChatContextWrapper>
	);
}
