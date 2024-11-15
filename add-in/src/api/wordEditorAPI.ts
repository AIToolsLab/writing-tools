import { Auth0ContextInterface, useAuth0 } from '@auth0/auth0-react';

export const wordEditorAPI: EditorAPI = {
	doLogin: async (auth0Client: Auth0ContextInterface) => {
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
			const messageFromDialog = JSON.parse(args.message);
			dialog.close();

			if (messageFromDialog.status === 'success') {
				// The dialog reported a successful login.
				auth0Client.handleRedirectCallback(messageFromDialog.urlWithAuthInfo);
			}
			else {
				// eslint-disable-next-line no-console
				console.error('Login failed.', messageFromDialog);
			}
		};

		await auth0Client.loginWithRedirect({
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
	getDocContext(positionalSensitivity: boolean): Promise<string> {
		return new Promise<string>(async (resolve, reject) => {
			try {
				await Word.run(async (context: Word.RequestContext) => {
					const body: Word.Body = context.document.body;
					let contextText = '';

					if (positionalSensitivity) {
						// wordSelection will only be word touching cursor if none highlighted
						const wordSelection = context.document
							.getSelection()
							.getTextRanges([' '], false);

						context.load(wordSelection, 'items');
						await context.sync();

						// Get range from beginning of doc up to the last word in wordSelection
						const lastCursorWord = wordSelection
							.items[wordSelection.items.length - 1];
						const contextRange = lastCursorWord.expandTo(body.getRange('Start'));

						context.load(contextRange, 'text');
						await context.sync();
						contextText = contextRange.text;
					}
					else {
						context.load(body, 'text');
						await context.sync();
						contextText = body.text;
					}
					resolve(contextText);
				});
			}
            catch (error) {
				reject(error);
			}
		});
	},
	
	getCursorPosInfo() {
		return new Promise<{charsToCursor: number, docLength: number}>(async (resolve, _reject) => {
			await Word.run(async (context: Word.RequestContext) => {
				const body: Word.Body = context.document.body;

				const cursorSelection = context.document.getSelection();
				const rangeToCursor = cursorSelection.expandTo(body.getRange('Start'));

				context.load(rangeToCursor, 'text');
				context.load(body, 'text');
				
				await context.sync();

				const charsToCursor = rangeToCursor.text.toString().length;
				
				const docLength = body.text.toString().length;
				resolve({ charsToCursor, docLength });
			});
		});
	}
};
