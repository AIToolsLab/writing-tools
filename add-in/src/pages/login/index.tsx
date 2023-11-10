import { useContext, useState } from 'react';

import { UserContext } from '@/contexts/userContext';
import { PageContext } from '@/contexts/pageContext';

// TODO FIXME don't copy-paste this from papup.tsx
const auth0Subdomain = 'dev-62nhczyl7e1oaj8a.us.auth0.com';
const auth0ClientId = 'W6MVTHKKbejEq7tCcT2oLt8gStOeHxT7';

import classes from './styles.module.css';

export default function Login() {
	const { changePage } = useContext(PageContext);

	let dialog: Office.Dialog;

	async function processMessage(
		args:
			| { message: string; origin: string | undefined }
			| { error: number }
	) {
		if ('error' in args) {
			console.error('Error:', args.error);
			return;
		}
		let messageFromDialog = JSON.parse(args.message);
		dialog.close();

		if (messageFromDialog.status === 'success') {
			// The dialog reported a successful login.
			let token = messageFromDialog.auth0Token;
			console.log('Login successful.', token);
			// Get the userinfo from auth0
			let userinfoResponse = await fetch(
				`https://${auth0Subdomain}/userinfo?access_token=${token}`
			);
			let userinfo = await userinfoResponse.json();
			console.log('Userinfo:', userinfo);

			// Make a test authenticated request to the server
			let testResponse = await fetch('/api/test', {
				headers: {
					Authorization: `Bearer ${token}`
				}
			});
		} else {
			console.error('Login failed.', messageFromDialog);
		}
	}

	return (
		<div className={classes.container}>
			<button
				onClick={async () => {
					// from https://github.com/OfficeDev/Office-Add-in-Auth0/blob/master/Scripts/index.js
					// Create the popup URL and open it.
					let fullUrl =
						location.protocol +
						'//' +
						location.hostname +
						(location.port ? ':' + location.port : '') +
						'/popup.html';

					// height and width are percentages of the size of the screen.
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
				}}
			>
				Login
			</button>
		</div>
	);
}
