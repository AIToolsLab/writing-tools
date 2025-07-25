import { useEffect, useState } from 'react';

/**
 * Converts a Word paragraph object into a usable string by removing leading and trailing
 * spaces and replacing the special Unicode character (that may represent comment).
 *
 * @param {Word.Paragraph} paragraphTextObject - The Word paragraph object.
 * @returns {string} - The converted paragraph text as a usable string.
 */
export function getParagraphText(paragraphTextObject: Word.Paragraph): string {
	return paragraphTextObject.text.trim().replace('\u0005', '');
}

/**
 * Resize textarea to fit text content
 *
 * @param {HTMLTextAreaElement} textarea - The textarea element to resize.
 * @returns {void}
 */
export function handleAutoResize(textarea: HTMLTextAreaElement): void {
	textarea.style.height = '100%';
	textarea.style.height = `${textarea.scrollHeight}px`;
}

/**
 * Hook to manage the document context in the editor.
 */
export function useDocContext(editorAPI: EditorAPI) {
	const {
		addSelectionChangeHandler,
		removeSelectionChangeHandler,
		getDocContext,
	} = editorAPI;

	const [docContext, updateDocContext] = useState<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	});

	 // Register event handlers for selection changes in the document.
	useEffect(() => {
		function handleSelectionChanged(): void {
			// Get the document context (before cursor, selected text, after cursor)
			getDocContext().then((docInfo: DocContext) => {
				updateDocContext(docInfo);
			});
		}

		// Handle initial selection change
		handleSelectionChanged();

		// Handle subsequent selection changes
		addSelectionChangeHandler(handleSelectionChanged);

		// Cleanup
		return () => {
			removeSelectionChangeHandler(handleSelectionChanged);
		};
	}, [
		addSelectionChangeHandler,
		getDocContext,
		removeSelectionChangeHandler,
	]);
	return docContext;
}
