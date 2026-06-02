'use client';

import { createContext } from 'react';
import type { DocContext, EditorAPI } from '@/lib/types';

// Provides the active platform's editor API through context. The default is an inert
// standalone-style implementation; each surface (Word / standalone) supplies its own.
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
});
