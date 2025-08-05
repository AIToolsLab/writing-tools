import { type PropsWithChildren, createContext } from 'react';

// Provides editor API functionality through context
export const EditorContext = createContext<EditorAPI>({
	doLogin: async () => {},
	doLogout: async () => {},
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
