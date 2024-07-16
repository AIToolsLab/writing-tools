import { useContext } from 'react';

import { UserContext } from '@/contexts/userContext';

import Login from '../login';
import QvE from '../qve';
import { wordEditorAPI } from '@/api/wordEditorAPI';

export interface HomeProps {
	isOfficeInitialized: boolean;
}

export default function App({ isOfficeInitialized }: HomeProps) {
	if (!isOfficeInitialized)
		return (
			<section>
				<p>Please sideload your addin to see app body.</p>
			</section>
		);

	const { username } = useContext(UserContext);

	if (username.length === 0) return <Login />;

	return <QvE editorAPI={ wordEditorAPI }/>;
}
