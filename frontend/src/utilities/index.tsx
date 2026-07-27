import { useCallback, useEffect, useState } from 'react';

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
 * Hook that exposes the current document context with a pull-based API.
 *
 * Rather than subscribing to pushed selection-change events, this pulls the
 * context on mount and whenever the user returns to the sidebar (focus /
 * visibility) — the moments a displayed context can go stale. This matters for
 * the Google Docs surface, where there is no native selection event and the
 * only way to observe changes is to re-fetch the whole document through Apps
 * Script; an always-on poll there is expensive and slow. Callers that act on
 * the document (send a message, run a feature, generate a suggestion) should
 * call `refresh()` at that moment to get the freshest value instead of relying
 * on the last displayed one.
 *
 * @returns `docContext` — the last pulled context (for display), `isLoading` —
 *   true until the first pull settles, and `refresh` — pulls the latest
 *   context, updates `docContext`, and resolves with the fresh value.
 */
export function useDocContext(editorAPI: EditorAPI) {
	const { getDocContext } = editorAPI;

	const [docContext, updateDocContext] = useState<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	});
	// The initial value above is indistinguishable from a genuinely empty
	// document, so callers need to know which one they are looking at: on the
	// Google Docs surface the first pull is an Apps Script round-trip, and until
	// it lands a page that renders `docContext` is describing a document it has
	// not read yet. Only the *first* pull flips this — later refreshes (which
	// pages run at request time) must not make the page look like it is
	// reloading.
	const [isLoading, setIsLoading] = useState(true);

	const refresh = useCallback(async (): Promise<DocContext> => {
		try {
			const latest = await getDocContext();
			updateDocContext(latest);
			return latest;
		} finally {
			// Settled, not succeeded: a failed pull must still end the loading
			// state, or the page spins forever on an error it can't see.
			setIsLoading(false);
		}
	}, [getDocContext]);

	// Pull on mount, and again whenever the sidebar regains focus / becomes
	// visible (i.e. the user came back from editing the document).
	useEffect(() => {
		function pull(): void {
			refresh().catch((e: unknown) => {
				// Nothing here can recover from a failed pull; log it rather than
				// letting it surface as an unhandled rejection.
				console.error('Failed to read the document context:', e);
			});
		}

		pull();

		function handleReturnToSidebar(): void {
			if (document.visibilityState === 'visible') {
				pull();
			}
		}

		window.addEventListener('focus', handleReturnToSidebar);
		document.addEventListener('visibilitychange', handleReturnToSidebar);
		return () => {
			window.removeEventListener('focus', handleReturnToSidebar);
			document.removeEventListener('visibilitychange', handleReturnToSidebar);
		};
	}, [refresh]);

	return { docContext, isLoading, refresh };
}
