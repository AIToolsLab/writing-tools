import { useContext } from 'react';

import { PageContext } from '@/contexts/pageContext';
import { UserContext } from '@/contexts/userContext';

import { useAuth0 } from '@auth0/auth0-react';


import Layout from '@/components/layout';

import Home from '../home';
import Focals from '../focals';
import SearchBar from '../searchbar';
import Chat from '../chat';
import Login from '../login';
import QvE from '../qve';
import { wordEditorAPI } from '@/api/wordEditorAPI';

export interface HomeProps {
	editorAPI: EditorAPI | null;
}

export default function App({ editorAPI }: HomeProps) {
	const { username } = useContext(UserContext);

	if (username.length === 0) return <Login />;

	const { isLoading, error, loginWithPopup, isAuthenticated } = useAuth0();
	if (isLoading) return <div>Loading...</div>;
	if (error) return <div>Oops... { error.message }</div>;
	if (!isAuthenticated) {
		return (
			<div>
				<button onClick= { () => {
					loginWithPopup();
				} }>Log in</button>
			</div>
		);
	}

	const { page } = useContext(PageContext);

	// eslint-disable-next-line eqeqeq
	const trueEditorAPI = (editorAPI == null) ? wordEditorAPI : editorAPI;

	function getComponent(pageName: string) {
		if (pageName === 'reflections') return <Home />;
		if (pageName === 'focals') return <Focals />;
		if (pageName === 'searchbar') return <SearchBar />;
		if (pageName === 'chat') return <Chat />;
		if (pageName === 'qve') return <QvE editorAPI={ trueEditorAPI } />;

		// eslint-disable-next-line no-console
		console.error('Invalid page name', pageName);
	}

	return <Layout>{ getComponent(page) }</Layout>;
}
