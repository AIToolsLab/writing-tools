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

	const { isLoading, error, loginWithPopup, isAuthenticated, user } = useAuth0();
	if (isLoading) return <div>Loading...</div>;
	if (error) return <div>Oops... { error.message }</div>;
	if (!isAuthenticated) {
		let dialog: Office.Dialog;

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
				// eslint-disable-next-line prefer-const
				let token = messageFromDialog.auth0Token;
				// eslint-disable-next-line no-console
				console.log('Login successful.', token);

				// Mock the window message event that auth0-spa-js expects
				window.dispatchEvent(
					// look up what the messagevent is in the Auth0 app
					new MessageEvent('message', {
						data: {
							origin: `https://${auth0Subdomain}`,
							data: {
								type: 'authorization_response',
								response: token // or something like that, mocking whatever the popup actually sends
							}
						}
					})
				);
			}
			else {
				// eslint-disable-next-line no-console
				console.error('Login failed.', messageFromDialog);
			}
		};


		const mockPopup = {
			location: { href: '' },
			closed: false,
			close: () => {},
		};
	// Actually make a popup using MS dialog API
	// hook the message event from the popup to set close false and get the token
	return (
		<div>
			Login here:
			<button onClick= { async () => {
				// Set up an Office dialog to do the login flow
				const fullUrl = location.protocol +
				'//' +
				location.hostname +
				(location.port ? ':' + location.port : '') +
				'/popup.html';

				// height and width are percentages of the size of the screen.
				// How MS use it: https://github.com/OfficeDev/Office-Add-in-samples/blob/main/Samples/auth/Office-Add-in-Microsoft-Graph-React/utilities/office-apis-helpers.ts#L38
				Office.context.ui.displayDialogAsync(
					fullUrl,
					{ height: 45, width: 55 },
					function (result) {
						dialog = result.value;
						dialog.addEventHandler(
							Office.EventType.DialogMessageReceived,
							processMessage
						);
					}
				);

				// Use this dialog for the Auth0 client library.
				try {
					await loginWithPopup(
						undefined,
						{
							popup: mockPopup
						}
					);
				}
				catch(e) {
					if (e instanceof PopupCancelledError) {
					  // Popup was closed before login completed
						// esline-disable-next-line no-console
						console.error('Cancelled login');
					}
				}
			}
		}
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

	return <Layout>{ user }{ getComponent(page) }</Layout>;
}
