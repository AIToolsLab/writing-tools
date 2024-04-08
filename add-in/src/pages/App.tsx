import { useContext } from 'react';

import { PageContext } from '@/contexts/PageContext';

import Layout from '@/components/layout/Layout';

import Home from './home/HomePage';
import Chat from './chat/ChatPage';
import Login from './login/LoginPage';

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

	const { page } = useContext(PageContext);

	if (page === 'login') return <Login />;

	return <Layout>{  page === 'reflections' ? <Home /> : <Chat /> }</Layout>;
}
