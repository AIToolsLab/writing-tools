import { useContext } from 'react';

import { PageContext } from '@/contexts/pageContext';

import Layout from '@/components/layout';

import Home from '../home';
import Chat from '../chat';
import Login from '../login';
import { useAuth0 } from '@auth0/auth0-react';

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
		
	const { isLoading, error, loginWithPopup, isAuthenticated } = useAuth0();

	if (isLoading) return <div>Loading...</div>;
	if (error) return <div>Oops... {error.message}</div>;

	if (!isAuthenticated) {
		return <div>
			<button onClick={() => {
				loginWithPopup();
			}}>Log in</button>
		</div>
	}

	const { page } = useContext(PageContext);

	if (page === 'login') return <Login />;

	return <Layout>{page === 'reflections' ? <Home /> : <Chat />}</Layout>;
}
