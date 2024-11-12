import { useContext, useState } from 'react';
import { useWindowSize } from '@react-hook/window-size/throttled';

import { UserContext } from '@/contexts/userContext';
import { PageContext } from '@/contexts/pageContext';  // pasted from the branch auth0

// TODO FIXME don't copy-paste this from papup.tsx - pasted from the branch auth0
const auth0Subdomain: string = 'dev-rbroo1fvav24wamu.us.auth0.com';
const auth0ClientId: string = 'YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr';

import classes from './styles.module.css';

export default function Login() {
	// pasted from the branch auth0
	const { changePage } = useContext(PageContext);

	let dialog: Office.Dialog;

	// async function processMessage(
	// 	args:
	// 		| { message: string; origin: string | undefined }
	// 		| { error: number }
	// ) {
	// 	if ('error' in args) {
	// 		// eslint-disable-next-line no-console
	// 		console.error('Error:', args.error);
	// 		return;
	// 	}
	// 	// eslint-disable-next-line prefer-const
	// 	let messageFromDialog = JSON.parse(args.message);
	// 	dialog.close();

	// 	if (messageFromDialog.status === 'success') {
	// 		// The dialog reported a successful login.
	// 		// eslint-disable-next-line prefer-const
	// 		let token = messageFromDialog.auth0Token;
	// 		// eslint-disable-next-line no-console
	// 		console.log('Login successful.', token);

	// 		window.dispatchEvent(
	// 			new MessageEvent('message', {
	// 				data: {
	// 					type: 'auth0Token',
	// 					response: token
	// 				}
	// 			})
	// 		)

	// 		// Get the userinfo from auth0
	// 		// eslint-disable-next-line prefer-const
	// 		let userinfoResponse = await fetch(
	// 			`https://${auth0Subdomain}/userinfo?access_token=${token}`
	// 		);
	// 		// eslint-disable-next-line prefer-const
	// 		let userinfo = await userinfoResponse.json();
	// 		// eslint-disable-next-line no-console
	// 		console.log('Userinfo:', userinfo);

	// 		// Make a test authenticated request to the server
	// 		// eslint-disable-next-line prefer-const
	// 		let testResponse = await fetch('/api/private', {
	// 			headers: {
	// 				Authorization: `Bearer ${token}`
	// 			}
	// 		});
	// 	} else {
	// 		// eslint-disable-next-line no-console
	// 		console.error('Login failed.', messageFromDialog);
	// 	}
	// }

	async function processMessage(
		args:
			| { message: string; origin: string | undefined }
			| { error: number }
	) {
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
	}


	const { updateUsername } = useContext(UserContext);
	const [width, _height] = useWindowSize();

	const [userId, updateId] = useState('');


	return (
		<div className={ classes.container  }>
			<button
				onClick= { async () => {
					// from https://github.com/OfficeDev/Office-Add-in-Auth0/blob/master/Scripts/index.js
					// Create the popup URL and open it.
					// eslint-disable-next-line prefer-const
					let fullUrl =
						location.protocol +
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

					// changePage('chat'); // Need to add randomness back to page switching
				} }
			>
				Login
			</button>
		</div>
	);
}
