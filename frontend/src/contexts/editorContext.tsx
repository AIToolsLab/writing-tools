import { createContext } from 'react';

import { loadScratchpadLocal, saveScratchpadLocal } from '@/api/scratchpadStore';

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
	getDocText: () => Promise.resolve(''),
	getParagraphs: () => Promise.resolve([]),
	applyEdit: () => {
		console.warn('applyEdit is not implemented yet');
		return Promise.resolve();
	},
	loadScratchpad: () => loadScratchpadLocal(),
	saveScratchpad: (text: string) => saveScratchpadLocal(text),
});
