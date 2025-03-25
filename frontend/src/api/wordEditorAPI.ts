import { Auth0ContextInterface } from '@auth0/auth0-react';

export const wordEditorAPI: EditorAPI = {
	async doLogin(auth0Client: Auth0ContextInterface): Promise<void> {
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
				if (dialog) dialog.close();
				return;
			}
			const messageFromDialog = JSON.parse(args.message);
			if (dialog) dialog.close();

			if (messageFromDialog.status === 'success') {
				// The dialog reported a successful login.
				try {
					auth0Client.handleRedirectCallback(messageFromDialog.urlWithAuthInfo);
				}
				catch (error) {
					// eslint-disable-next-line no-console
					console.error('auth0Client.handleRedirectCallback Error:', error);
				}
			}
			else {
				// eslint-disable-next-line no-console
				console.error('Login failed.', messageFromDialog);
			}
		};

		await auth0Client.loginWithRedirect({
			openUrl: async (url: string) => {
				try {
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
				catch (error) {
					// eslint-disable-next-line no-console
					console.error('Error opening URL:', error);
				}
			}
		});
	},

	async doLogout(auth0Client: Auth0ContextInterface): Promise<void> {
		let dialog: Office.Dialog;

		// Strategy: the popup will pass its redirect-callback data here, so we can pass it on to handleRedirectCallback
		const processMessage = async (
			args:
				| { message: string; origin: string | undefined }
				| { error: number }
		) => {
			dialog.close();
			if ('error' in args) {
				// eslint-disable-next-line no-console
				console.error('Error:', args.error);
				return;
			}
			const messageFromDialog = JSON.parse(args.message);

			if (messageFromDialog.status === 'success') {
				// The dialog reported a successful logout.
				// It seems like we don't need to do anything here, since the auth0 client library has already cleared its cached credentials.
			}
			else {
				// eslint-disable-next-line no-console
				console.error('Logout failed.', messageFromDialog);
			}
		};

		await auth0Client.logout({
			openUrl: async (url: string) => {
				const redirect = encodeURIComponent(url);
				const bounceURL = location.protocol + '//' + location.hostname + (location.port ? ':' + location.port : '') + '/popup.html?redirect=' + redirect;
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
			},
			logoutParams: {
				returnTo: `${location.origin}/popup.html?logout=true`
			}
		});
	},

	addSelectionChangeHandler: (handler: () => void) => {
		Office.context.document.addHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			handler
		);
	},
	removeSelectionChangeHandler: (handler: () => void) => {
		Office.context.document.removeHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			handler
		);
	},

	/**
	 * Retrieves the text content of the Word document.
	 */
	getDocContext(): Promise<DocContext> {
		return new Promise<DocContext>(async (resolve, reject) => {
			try {
				await Word.run(async (context: Word.RequestContext) => {
					const body: Word.Body = context.document.body;
					const docContext: DocContext = {
						beforeCursor: '',
						selectedText: '',
						afterCursor: ''
					};

					// Get the selected word
					const wordSelection = context.document.getSelection();

					context.load(wordSelection, 'items');
					await context.sync();

					// Get the text of the selected word
					docContext.selectedText = wordSelection.text;

					// Get the text before the selected word
					const beforeCursor = wordSelection.expandTo(body.getRange('Start'));
					context.load(beforeCursor, 'text');

					// Get the text after the selected word
					const afterCursor = wordSelection.expandTo(body.getRange('End'));
					context.load(afterCursor, 'text');

					await context.sync();

					// Set the beforeCursor and afterCursor properties of the docContext object
					// Note that we only slice only if the selected text is not empty
					docContext.beforeCursor = beforeCursor.text.slice(0, -docContext.selectedText.length) || beforeCursor.text;
					docContext.afterCursor = afterCursor.text.slice(docContext.selectedText.length);
					resolve(docContext);
				});
			}
			catch (error) {
				reject(error);
			}
		});
	}
};
