import { useContext } from 'react';

import { PageContext } from '@/contexts/pageContext';
import { UserContext } from '@/contexts/userContext';

import { PopupCancelledError, useAuth0 } from '@auth0/auth0-react';


import Layout from '@/components/layout';

import Home from '../home';
import Focals from '../focals';
import SearchBar from '../searchbar';
import Chat from '../chat';
import QvE from '../qve';
import { wordEditorAPI } from '@/api/wordEditorAPI';

export interface HomeProps {
	editorAPI: EditorAPI | null;
}

export default function App({ editorAPI }: HomeProps) {
	const { username } = useContext(UserContext);

	const { isLoading, error, loginWithRedirect, handleRedirectCallback, isAuthenticated, user, logout } = useAuth0();
	if (isLoading) return <div>Loading...</div>;
	if (error) return (
  <div>Oops... { error.message }
		<button onClick={ () => {
			window.location.reload();
			} }>Reload</button>
	</div>
);
	if (!isAuthenticated) {
		let dialog: Office.Dialog;

		// Strategy: the popup will pass its redirect-callback data here, so we can pass it on to handleRedirectCallback
		const processMessage = async (
			args:
				| { message: string; origin: string | undefined }
				| { error: number }
		) => {
			if ('error' in args) {
				// eslint-disable-next-line no-console
				console.error('Error:', args.error);
				return;
			}
			// eslint-disable-next-line prefer-const
			let messageFromDialog = JSON.parse(args.message);
			dialog.close();

			if (messageFromDialog.status === 'success') {
				// The dialog reported a successful login.
				handleRedirectCallback(messageFromDialog.urlWithAuthInfo);
			}
			else {
				// eslint-disable-next-line no-console
				console.error('Login failed.', messageFromDialog);
			}
		};

	// Actually make a popup using MS dialog API
	// hook the message event from the popup to set close false and get the token
	return (
		<div>
			Login here:
			<button onClick= { async () => {
				// Use this dialog for the Auth0 client library.
				await loginWithRedirect({
					openUrl: async (url: string) => {
						const redirect = encodeURIComponent(url);
						const bounceURL = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') + '/popup.html?redirect=' + redirect;
						// height and width are percentages of the size of the screen.
						// How MS use it: https://github.com/OfficeDev/Office-Add-in-samples/blob/main/Samples/auth/Office-Add-in-Microsoft-Graph-React/utilities/office-apis-helpers.ts#L38
						Office.context.ui.displayDialogAsync(
							bounceURL,
							{ height: 45, width: 55 },
							function (result) {
								dialog = result.value;
								dialog.addEventHandler(
									Office.EventType.DialogMessageReceived,
									processMessage
								);
							}
						);
					}
				});
		}}
				>Log in
			</button>
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

	return (
		<Layout>
			User: { user!.name }<button onClick={ () => logout() }>LogOut</button>{ getComponent(page) }
		</Layout>
		);
}
