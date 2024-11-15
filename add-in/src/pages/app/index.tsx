import { useContext } from 'react';

import { PageContext } from '@/contexts/pageContext';
import { useAuth0 } from '@auth0/auth0-react';
import { ThemeProvider } from '@fluentui/react';
import PageContextWrapper from '@/contexts/pageContext';
import UserContextWrapper from '@/contexts/userContext';
import ChatContextWrapper from '@/contexts/chatContext';
import { Auth0Provider } from '@auth0/auth0-react';

import Layout from '@/components/layout';

import Home from '../home';
import Focals from '../focals';
import SearchBar from '../searchbar';
import Chat from '../chat';
import QvE from '../qve';

export interface HomeProps {
	editorAPI: EditorAPI;
}

function AppInner({ editorAPI }: HomeProps) {
	const auth0Client = useAuth0();
	const { isLoading, error, isAuthenticated, user, logout } = auth0Client;
	if (isLoading) return <div>auth0 says Loading...</div>;
	if (error) return (
  <div>Oops... { error.message }
		<button onClick={ () => {
			window.location.reload();
			} }>Reload</button>
	</div>
);
	if (!isAuthenticated) {
	return (
		<div>
			Login here:
			<button onClick= { async () => {
				await editorAPI.doLogin(auth0Client);
			}}
				>Log in
			</button>
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
			User: { user!.name }<button onClick={ () => {
				console.log("origin", window.location.origin);
				logout({
					logoutParams: {returnTo: `${window.location.href}`}
				});
			 }}>LogOut</button>{ getComponent(page) }
		</Layout>
		);
}

export default function App({ editorAPI }: HomeProps) {
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