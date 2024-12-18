import { useContext } from 'react';

import { PageContext } from '@/contexts/pageContext';
import { CgFacebook, CgGoogle, CgMicrosoft } from 'react-icons/cg';
import { useWindowSize } from '@react-hook/window-size/throttled';

import { useAuth0, Auth0Provider } from '@auth0/auth0-react';
// eslint-disable-next-line no-duplicate-imports
import PageContextWrapper from '@/contexts/pageContext';
import UserContextWrapper from '@/contexts/userContext';
import ChatContextWrapper from '@/contexts/chatContext';

import classes from './styles.module.css';

import Layout from '@/components/layout';

import Revise from '../revise';
import SearchBar from '../searchbar';
import Chat from '../chat';
import Draft from '../draft';
import { wordEditorAPI } from '@/api/wordEditorAPI';

export interface HomeProps {
	editorAPI: EditorAPI;
}

function AppInner({ editorAPI }: HomeProps) {
	const auth0Client = useAuth0();
	const { isLoading, error, isAuthenticated, user, logout } = auth0Client;
	const [width, _height] = useWindowSize();
	const { page } = useContext(PageContext);

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
	if (!isAuthenticated) {
		return (
			<div className={ classes.loginContainer }>
				<h3>Not logged in yet?</h3>
				<button
					className={ classes.loginButton }
					onClick= { async () => {
						await editorAPI.doLogin(auth0Client);
					} }
				>
					<p>Login</p>
				</button>

				<hr />

				<p>Available Auth Providers</p>
				<div className={ classes.authProviderIconContainer }>
					<CgGoogle
						className={ classes.authProviderIcon }
					/>
					<CgMicrosoft
						className={ classes.authProviderIcon }
					/>
					<CgFacebook
						className={ classes.authProviderIcon }
					/>
				</div>

				<div className={ classes.widthAlert } style={ { visibility: width < 400 ? 'visible' : 'hidden' } }>
					For best experience please expand the sidebar by dragging the splitter.
				</div>

				<div className={ classes.versionAlert } style={ { visibility: !isOfficeLatest() ? 'visible' : 'hidden' } }>
					This add-in will not run in your version of Office. Please upgrade either to
					perpetual Office 2021 (or later) or to a Microsoft 365 account.
				</div>
			</div>
		);
	}

	function getComponent(pageName: string) {
		if (pageName === 'revise') return <Revise />;
		if (pageName === 'searchbar') return <SearchBar />;
		if (pageName === 'chat') return <Chat />;
		if (pageName === 'draft') return <Draft editorAPI={ editorAPI } />;

		// eslint-disable-next-line no-console
		// console.error('Invalid page name', pageName);
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
					logout({
						logoutParams: { returnTo: `${window.location.href}` }
					});
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
						domain="dev-rbroo1fvav24wamu.us.auth0.com"
						clientId="YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr"
						authorizationParams= { {
							redirectUri: `${window.location.origin}/popup.html`,
							scope: 'openid profile email read:posts',
							audience: 'textfocals.com', // Value in Identifier field for the API being called.
							leeway: 10
						} }
					>		<AppInner editorAPI={ editorAPI } />
				</Auth0Provider>
				</PageContextWrapper>
			</UserContextWrapper>
		</ChatContextWrapper>
	);
}
