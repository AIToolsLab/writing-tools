export function wordDocumentLabel(url: string | undefined): string {
	if (!url) return 'Word document';
	let value = url;
	if (/^https?:\/\//i.test(url)) {
		try {
			value = new URL(url).pathname;
		} catch {
			// Treat malformed HTTP(S) values as opaque paths below.
		}
	}
	const segments = value.split(/[\\/]/).filter(Boolean);
	const filename = segments[segments.length - 1];
	if (!filename) return 'Word document';
	try {
		return decodeURIComponent(filename);
	} catch {
		return filename;
	}
}

/**
 * Whether the host supports `getReviewedText` (WordApi 1.4). We use it to read
 * the document as if tracked changes were accepted, so the AI never sees deleted
 * text in the corpus or `view`. Falls back to raw `.text` on older hosts.
 */
function supportsReviewedText(): boolean {
	try {
		return Office.context.requirements.isSetSupported('WordApi', '1.4');
	} catch {
		return false;
	}
}

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
					documentLabel: wordDocumentLabel(Office.context.document.url),
					beforeCursor: '',
					selectedText: '',
					afterCursor: '',
				};

				const wordSelection = context.document.getSelection();
				const beforeCursor = wordSelection
					.getRange('Start')
					.expandTo(body.getRange('Start'));
				const afterCursor = wordSelection
					.getRange('End')
					.expandTo(body.getRange('End'));

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

	/**
	 * Reads an add-in setting stored inside the .docx itself.
	 *
	 * `settings.get` reads the copy Office loaded with the document, so this is
	 * synchronous despite the Promise — there is no round-trip to make.
	 */
	getDocumentSetting(key: string): Promise<string | null> {
		try {
			const value: unknown = Office.context.document.settings.get(key);
			return Promise.resolve(typeof value === 'string' ? value : null);
		} catch (error) {
			console.warn(`Could not read document setting "${key}":`, error);
			return Promise.resolve(null);
		}
	},

	/**
	 * Writes an add-in setting into the .docx.
	 *
	 * `set` only updates Office's in-memory copy; `saveAsync` is what commits it
	 * to the document, which is what makes the value survive a reload and follow
	 * the file to the next person who opens it.
	 */
	setDocumentSetting(key: string, value: string): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const settings = Office.context.document.settings;
			settings.set(key, value);
			settings.saveAsync((result) => {
				if (result.status === Office.AsyncResultStatus.Succeeded) {
					resolve();
				} else {
					reject(
						new Error(
							result.error?.message ??
								`Failed to save document setting "${key}"`,
						),
					);
				}
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

	/**
	 * Full document text, used for the corpus and the `view` tool. Reads the
	 * "current" reviewed text so tracked-change deletions are excluded — the AI
	 * should only ever see the writer's accepted words, not struck-through text.
	 */
	async getDocText(): Promise<string> {
		return Word.run(async (context: Word.RequestContext) => {
			const body = context.document.body;
			if (supportsReviewedText()) {
				const reviewed = body.getReviewedText('Current');
				await context.sync();
				return reviewed.value.replace(/\r/g, '\n');
			}
			context.load(body, 'text');
			await context.sync();
			return body.text.replace(/\r/g, '\n');
		});
	},

	/**
	 * Paragraphs in order — the coordinate system for `view` and inserts. Like
	 * getDocText, each paragraph is read as its reviewed ("current") text so
	 * tracked deletions don't leak to the AI.
	 */
	async getParagraphs(): Promise<string[]> {
		return Word.run(async (context: Word.RequestContext) => {
			const paragraphs = context.document.body.paragraphs;
			if (!supportsReviewedText()) {
				context.load(paragraphs, 'items/text');
				await context.sync();
				return paragraphs.items.map((p) => p.text.replace(/\r/g, '\n'));
			}
			context.load(paragraphs, 'items');
			await context.sync();
			const reviewed = paragraphs.items.map((p) =>
				p.getRange().getReviewedText('Current'),
			);
			await context.sync();
			return reviewed.map((r) => r.value.replace(/\r/g, '\n'));
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
				// Scope the search to one paragraph when given — disambiguates
				// repeated text and dodges the body-search length limit.
				let scope: Word.Body | Word.Range = body;
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
					scope = paragraphs.items[edit.paragraph - 1].getRange();
				}
				const results = scope.search(edit.oldStr, searchOptions);
				context.load(results, 'items');
				await context.sync();
				if (results.items.length === 0) {
					throw new Error(
						edit.paragraph !== undefined
							? `Could not find "${edit.oldStr}" in paragraph ${edit.paragraph}.`
							: `Could not find the text to replace: "${edit.oldStr}"`,
					);
				}
				results.items[0].insertText(
					edit.newStr,
					Word.InsertLocation.replace,
				);
				await context.sync();
				return;
			}

			if (edit.type === 'delete_paragraph') {
				// Remove the whole paragraph, mark included (splice shrinkage,
				// e.g. undoing an inserted paragraph — no empty residue).
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
				paragraphs.items[edit.paragraph - 1].delete();
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
