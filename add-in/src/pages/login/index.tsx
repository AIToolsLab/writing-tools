import { useContext, useState } from 'react';
import { useWindowSize } from '@react-hook/window-size/throttled';

import { UserContext } from '@/contexts/userContext';
import { PageContext } from '@/contexts/pageContext';  // pasted from the branch auth0

// TODO FIXME don't copy-paste this from papup.tsx - pasted from the branch auth0
const auth0Subdomain = 'dev-62nhczyl7e1oaj8a.us.auth0.com';
const auth0ClientId = 'W6MVTHKKbejEq7tCcT2oLt8gStOeHxT7';

import classes from './styles.module.css';

export default function Login() {
	// pasted from the branch auth0
	const { changePage } = useContext(PageContext);

	let dialog: Office.Dialog;

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
			// Get the userinfo from auth0
			// eslint-disable-next-line prefer-const
			let userinfoResponse = await fetch(
				`https://${auth0Subdomain}/userinfo?access_token=${token}`
			);
			// eslint-disable-next-line prefer-const
			let userinfo = await userinfoResponse.json();
			// eslint-disable-next-line no-console
			console.log('Userinfo:', userinfo);

			// Make a test authenticated request to the server
			// eslint-disable-next-line prefer-const
			let testResponse = await fetch('/api/private', {
				headers: {
					Authorization: `Bearer ${token}`
				}
			});
		} else {
			// eslint-disable-next-line no-console
			console.error('Login failed.', messageFromDialog);
		}
	}


	const { updateUsername } = useContext(UserContext);
	const [width, _height] = useWindowSize();

	const [userId, updateId] = useState('');

	// return (
	// 	<div className={ classes.container }>
	// 		<input
	// 			value={ userId }
	// 			placeholder="Username"
	// 			onChange={ e => updateId(e.target.value) }
	// 			onKeyDown={ e => {
	// 				if (e.key === 'Enter' && userId.length > 0)
	// 					updateUsername(userId);
	// 			} }
	// 		/>

	// 		<button
	// 			disabled={ userId.length === 0 }
	// 			onClick={ () => updateUsername(userId) }
	// 		>
	// 			Login
	// 		</button>

	// 		<div className={ classes.widthAlert }>
	// 			{ width < 400 &&
	// 				'For best experience please expand the sidebar by dragging the splitter.' }
	// 		</div>
	// 	</div>
	// );
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
