'use client';

import { useEffect, useState } from 'react';
import type { DocContext, EditorAPI } from './types';

/**
 * Hook to track the document context (text before/after the cursor and the selection)
 * from the active editor, re-reading it whenever the selection changes.
 */
export function useDocContext(editorAPI: EditorAPI): DocContext {
	const { addSelectionChangeHandler, removeSelectionChangeHandler, getDocContext } =
		editorAPI;

	const [docContext, updateDocContext] = useState<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	});

	// Register event handlers for selection changes in the document.
	useEffect(() => {
		function handleSelectionChanged(): void {
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
	}, [addSelectionChangeHandler, getDocContext, removeSelectionChangeHandler]);

	return docContext;
}
