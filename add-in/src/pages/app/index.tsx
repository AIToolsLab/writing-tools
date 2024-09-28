import { useContext } from 'react';

import { PageContext } from '@/contexts/pageContext';
import { UserContext } from '@/contexts/userContext';


import Layout from '@/components/layout';

import Home from '../home';
import Focals from '../focals';
import Chat from '../chat';
import Login from '../login';
import QvE from '../qve';
import { wordEditorAPI } from '@/api/wordEditorAPI';

export interface HomeProps {
	editorAPI: EditorAPI | null;
}

export default function App({  editorAPI }: HomeProps) {
	const { username } = useContext(UserContext);

	if (username.length === 0) return <Login />;

	const { page } = useContext(PageContext);

	let trueEditorAPI = (editorAPI === null) ? wordEditorAPI : editorAPI;

	function getComponent(pageName: string) {
		if (pageName === 'reflections') return <Home />;
		if (pageName === 'focals') return <Focals />;
		if (pageName === 'chat') return <Chat />;
		if (pageName === 'qve') return <QvE editorAPI={ trueEditorAPI } />;
		console.error('Invalid page name', pageName);
	}

	return <Layout>{ getComponent(page) }</Layout>;
}
