export const wordEditorAPI: EditorAPI = {

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
};
