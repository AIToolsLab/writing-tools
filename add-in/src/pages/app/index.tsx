import { useContext } from 'react';

import { PageContext } from '@/contexts/pageContext';
import { CgFacebook, CgGoogle, CgMicrosoft } from 'react-icons/cg';

import { useAuth0, Auth0Provider } from '@auth0/auth0-react';
import { ThemeProvider } from '@fluentui/react';
// eslint-disable-next-line no-duplicate-imports
import PageContextWrapper from '@/contexts/pageContext';
import UserContextWrapper from '@/contexts/userContext';
import ChatContextWrapper from '@/contexts/chatContext';

import classes from './styles.module.css';
import { Spinner, SpinnerSize } from '@fluentui/react/lib/Spinner';

import Layout from '@/components/layout';

import Home from '../home';
import Focals from '../focals';
import SearchBar from '../searchbar';
import Chat from '../chat';
import QvE from '../qve';
import { wordEditorAPI } from '@/api/wordEditorAPI';

export interface HomeProps {
	editorAPI: EditorAPI;
}

function AppInner({ editorAPI }: HomeProps) {
	const auth0Client = useAuth0();
	const { isLoading, error, isAuthenticated, user, logout } = auth0Client;
	if (isLoading) return (
		<div className={ classes.loadingContainer }>
			<div>Auth0 says Loading...</div>
			<div className={ classes.spinnerWrapper }>
				<Spinner size={ SpinnerSize.large } />
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
			</div>
		);
	}

	const { page } = useContext(PageContext);

	function getComponent(pageName: string) {
		if (pageName === 'reflections') return <Home />;
		if (pageName === 'focals') return <Focals />;
		if (pageName === 'searchbar') return <SearchBar />;
		if (pageName === 'chat') return <Chat />;
		if (pageName === 'qve') return <QvE editorAPI={ editorAPI } />;

		// eslint-disable-next-line no-console
		console.error('Invalid page name', pageName);
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
		<ThemeProvider>
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
		</ThemeProvider>
	);
}
