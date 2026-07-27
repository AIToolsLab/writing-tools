import { createContext } from 'react';
import { localStorageDocumentSettings } from '@/api/documentSettings';

// Provides editor API functionality through context
export const EditorContext = createContext<EditorAPI>({
	getDocContext: () =>
		new Promise<DocContext>((resolve) =>
			resolve({
				beforeCursor: '',
				selectedText: '',
				afterCursor: '',
			}),
		),
	addSelectionChangeHandler: () => {},
	removeSelectionChangeHandler: () => {},
	selectPhrase: () => {
		console.warn('selectPhrase is not implemented yet');
		return new Promise<void>((resolve) => resolve());
	},
	// No host document to write into without a provider, so document settings
	// fall back to this browser. Real surfaces override this whole object.
	...localStorageDocumentSettings('default'),
});
