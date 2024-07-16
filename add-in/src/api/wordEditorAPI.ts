export const wordEditorAPI: EditorAPI = {
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
