import { createContext } from 'react';

// Provides editor API functionality through context
export const EditorContext = createContext<EditorAPI>({
	openExternal: (url: string) => {
		window.open(url, '_blank', 'noopener');
	},
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
});
