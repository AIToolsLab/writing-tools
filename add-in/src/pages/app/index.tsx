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
	isOfficeInitialized: boolean;
}

export default function App({ isOfficeInitialized }: HomeProps) {
	if (!isOfficeInitialized)
		return (
			<section className="ms-welcome__progress ms-u-fadeIn500">
				<p>Please sideload your addin to see app body.</p>
			</section>
		);

	const { username } = useContext(UserContext);

	if (username.length === 0) return <Login />;

	const { page } = useContext(PageContext);

	function getComponent(pageName: string) {
		if (pageName === 'reflections') return <Home />;
		if (pageName === 'focals') return <Focals />;
		if (pageName === 'chat') return <Chat />;
		if (pageName === 'qve') return <QvE editorAPI={ wordEditorAPI } />;
		console.error('Invalid page name', pageName);
	}

	return <Layout>{ getComponent(page) }</Layout>;
}
