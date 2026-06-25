import type { Auth0ContextInterface } from '@auth0/auth0-react';

export const wordEditorAPI: EditorAPI = {
	async doLogin(auth0Client: Auth0ContextInterface): Promise<void> {
		let dialog: Office.Dialog;

		// Strategy: the popup will pass its redirect-callback data here, so we can pass it on to handleRedirectCallback
		const processMessage = (
			args:
				| { message: string; origin: string | undefined }
				| { error: number },
		) => {
			if ('error' in args) {
				 
				console.error('Error:', args.error);
				if (dialog) dialog.close();
				return;
			}
			const messageFromDialog = JSON.parse(args.message);
			if (dialog) dialog.close();

			if (messageFromDialog.status === 'success') {
				// The dialog reported a successful login.
				try {
					auth0Client.handleRedirectCallback(
						messageFromDialog.urlWithAuthInfo as string,
					);
				} catch (error) {
					 
					console.error(
						'auth0Client.handleRedirectCallback Error:',
						error,
					);
				}
			} else {
				 
				console.error('Login failed.', messageFromDialog);
			}
		};

		await auth0Client.loginWithRedirect({
			openUrl: (url: string) => {
				try {
					const redirect = encodeURIComponent(url);
					const bounceURL =
						location.protocol +
						'//' +
						location.hostname +
						(location.port ? ':' + location.port : '') +
						'/popup.html?redirect=' +
						redirect;
					// height and width are percentages of the size of the screen.
					// How MS use it: https://github.com/OfficeDev/Office-Add-in-samples/blob/main/Samples/auth/Office-Add-in-Microsoft-Graph-React/utilities/office-apis-helpers.ts#L38
					Office.context.ui.displayDialogAsync(
						bounceURL,
						{ height: 45, width: 55 },
						(result) => {
							dialog = result.value;
							dialog.addEventHandler(
								Office.EventType.DialogMessageReceived,
								processMessage,
							);
						},
					);
				} catch (error) {
					 
					console.error('Error opening URL:', error);
				}
			},
		});
	},

	async doLogout(auth0Client: Auth0ContextInterface): Promise<void> {
		let dialog: Office.Dialog;

		// Strategy: the popup will pass its redirect-callback data here, so we can pass it on to handleRedirectCallback
		const processMessage = (
			args:
				| { message: string; origin: string | undefined }
				| { error: number },
		) => {
			dialog.close();
			if ('error' in args) {
				 
				console.error('Error:', args.error);
				return;
			}
			const messageFromDialog = JSON.parse(args.message);

			if (messageFromDialog.status === 'success') {
				// The dialog reported a successful logout.
				// It seems like we don't need to do anything here, since the auth0 client library has already cleared its cached credentials.
			} else {
				 
				console.error('Logout failed.', messageFromDialog);
			}
		};

		await auth0Client.logout({
			openUrl: (url: string) => {
				const redirect = encodeURIComponent(url);
				const bounceURL =
					location.protocol +
					'//' +
					location.hostname +
					(location.port ? ':' + location.port : '') +
					'/popup.html?redirect=' +
					redirect;
				Office.context.ui.displayDialogAsync(
					bounceURL,
					{ height: 45, width: 55 },
					(result) => {
						dialog = result.value;
						dialog.addEventHandler(
							Office.EventType.DialogMessageReceived,
							processMessage,
						);
					},
				);
			},
			logoutParams: {
				returnTo: `${location.origin}/popup.html?logout=true`,
			},
		});
	},

	addSelectionChangeHandler: (handler: () => void) => {
		Office.context.document.addHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			handler,
		);
	},
	removeSelectionChangeHandler: (handler: () => void) => {
		Office.context.document.removeHandlerAsync(
			Office.EventType.DocumentSelectionChanged,
			handler,
		);
	},

	/**
	 * Retrieves the text content of the Word document.
	 */
	async getDocContext(): Promise<DocContext> {
		return new Promise<DocContext>((resolve, reject) => {
			Word.run(async (context: Word.RequestContext) => {
				const body: Word.Body = context.document.body;
				const docContext: DocContext = {
					beforeCursor: '',
					selectedText: '',
					afterCursor: '',
				};

				const wordSelection = context.document.getSelection();
				const beforeCursor = wordSelection.getRange('Start').expandTo(
					body.getRange('Start'),
				);
				const afterCursor = wordSelection.getRange('End').expandTo(
					body.getRange('End'),
				);

				// Request the content of these items from Word
				context.load(wordSelection, 'text');
				context.load(beforeCursor, 'text');
				context.load(afterCursor, 'text');
				await context.sync();
				
				docContext.beforeCursor = beforeCursor.text;
				docContext.selectedText = wordSelection.text;
				docContext.afterCursor = afterCursor.text;

				// Replace \r with \n for consistency
				docContext.beforeCursor = docContext.beforeCursor.replace(
					/\r/g,
					'\n',
				);
				docContext.selectedText = docContext.selectedText.replace(
					/\r/g,
					'\n',
				);
				docContext.afterCursor = docContext.afterCursor.replace(
					/\r/g,
					'\n',
				);
				resolve(docContext);
			}).catch((error) => {
				 
				console.error('Error getting document context:', error);
				reject(error as Error);
			});
		});
	},

	/** Select a phrase in the document. */
	selectPhrase(phrase: string): Promise<void> {
		return Word.run(async (context: Word.RequestContext) => {
			const body: Word.Body = context.document.body;
			const searchResults = body.search(phrase, {
				ignorePunct: true,
				ignoreSpace: true,
				matchCase: false,
				matchWildcards: false,
			});
			context.load(searchResults, 'items');
			await context.sync();

			if (searchResults.items.length > 0) {
				const firstResult = searchResults.items[0];
				firstResult.select();
				return;
			} else {
				throw new Error('Phrase not found');
			}
		});
	},

	/** Full document text, used for the corpus and the `view` tool. */
	async getDocText(): Promise<string> {
		return Word.run(async (context: Word.RequestContext) => {
			const body = context.document.body;
			context.load(body, 'text');
			await context.sync();
			return body.text.replace(/\r/g, '\n');
		});
	},

	/** Paragraphs in order — the coordinate system for `view` and inserts. */
	async getParagraphs(): Promise<string[]> {
		return Word.run(async (context: Word.RequestContext) => {
			const paragraphs = context.document.body.paragraphs;
			context.load(paragraphs, 'items/text');
			await context.sync();
			return paragraphs.items.map((p) => p.text.replace(/\r/g, '\n'));
		});
	},

	/**
	 * Apply a validated edit to the Word document. If the user has Track Changes
	 * on (Review ribbon → changeTrackingMode = TrackAll), these edits are
	 * recorded as revisions they can accept or reject — no extra work here.
	 *
	 * Note: Word's body.search() is limited to ~255 characters and does not match
	 * across paragraph breaks, so this supports sentence/phrase-level edits (how
	 * the AI already works), not multi-paragraph spans.
	 */
	applyEdit(edit: DocEdit): Promise<void> {
		return Word.run(async (context: Word.RequestContext) => {
			const body = context.document.body;
			const searchOptions: Word.SearchOptions | object = {
				matchCase: false,
				matchWildcards: false,
				ignorePunct: false,
				ignoreSpace: false,
			};

			if (edit.type === 'str_replace') {
				const results = body.search(edit.oldStr, searchOptions);
				context.load(results, 'items');
				await context.sync();
				if (results.items.length === 0) {
					throw new Error(
						`Could not find the text to replace: "${edit.oldStr}"`,
					);
				}
				results.items[0].insertText(
					edit.newStr,
					Word.InsertLocation.replace,
				);
				await context.sync();
				return;
			}

			// insert — by paragraph number (robust; avoids the search limit)
			if (edit.paragraph !== undefined) {
				const paragraphs = body.paragraphs;
				context.load(paragraphs, 'items');
				await context.sync();
				if (
					edit.paragraph < 1 ||
					edit.paragraph > paragraphs.items.length
				) {
					throw new Error(
						`Paragraph ${edit.paragraph} is out of range (1–${paragraphs.items.length}).`,
					);
				}
				paragraphs.items[edit.paragraph - 1].insertParagraph(
					edit.text,
					edit.position === 'before'
						? Word.InsertLocation.before
						: Word.InsertLocation.after,
				);
				await context.sync();
				return;
			}

			// insert — after an anchor string (within a paragraph)
			if (edit.after !== undefined && edit.after !== '') {
				const results = body.search(edit.after, searchOptions);
				context.load(results, 'items');
				await context.sync();
				if (results.items.length === 0) {
					throw new Error(
						`Could not find the anchor text: "${edit.after}"`,
					);
				}
				results.items[0].insertText(
					edit.text,
					Word.InsertLocation.after,
				);
			} else {
				// No anchor: insert at the current cursor / replace the selection.
				context.document
					.getSelection()
					.insertText(edit.text, Word.InsertLocation.replace);
			}
			await context.sync();
		});
	},
};
