import { useRef, useSyncExternalStore } from 'react';

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
		getDocContext
	} = editorAPI;

	const docContextRef = useRef<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: ''
	});

	// See https://react.dev/learn/you-might-not-need-an-effect#subscribing-to-an-external-store
	return useSyncExternalStore(
		function subscribe(callback: () => void): () => void {
			async function handleSelectionChanged(): Promise<void> {
				docContextRef.current = await getDocContext();
				callback(); // Notify subscribers of the change
			}
			// Subscribe to selection change events
			addSelectionChangeHandler(handleSelectionChanged);
			// Trigger the initial fetch of the document context
			handleSelectionChanged().catch(error => {
				// eslint-disable-next-line no-console
				console.error('Error fetching document context:', error);
			});
			// Return a cleanup function to remove the handler
			return () => {
				removeSelectionChangeHandler(handleSelectionChanged);
			};
		},
		function getSnapshot(): DocContext {
			return docContextRef.current;
		},
		function getServerSnapshot(): DocContext {
			// This function is used for server-side rendering, if applicable.
			// It should return the same snapshot as getSnapshot.
			return docContextRef.current;
		}
	);
}
