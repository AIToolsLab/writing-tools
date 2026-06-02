'use client';

import { useMemo, useRef } from 'react';
import App from '@/components/App';
import { EditorContext } from '@/contexts/editorContext';
import type { DocContext, EditorAPI } from '@/lib/types';
import LexicalEditor from './LexicalEditor';
import classes from './StandaloneEditor.module.css';

// The standalone surface: a Lexical editor on the left and the sidebar app on the right,
// backed by an in-memory EditorAPI. (The legacy demo mode and Auth0 login flow were
// dropped in the migration.)
export default function StandaloneEditor() {
	// Current document context, kept in a ref so the editor API reads the latest value.
	const docContextRef = useRef<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	});
	const selectionChangeHandlers = useRef<(() => void)[]>([]);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach((handler) => {
			handler();
		});
	};

	const editorAPI: EditorAPI = useMemo(
		() => ({
			getDocContext: async (): Promise<DocContext> => Promise.resolve(docContextRef.current),
			addSelectionChangeHandler: (handler: () => void) => {
				selectionChangeHandlers.current.push(handler);
			},
			removeSelectionChangeHandler: (handler: () => void) => {
				const index = selectionChangeHandlers.current.indexOf(handler);
				if (index !== -1) selectionChangeHandlers.current.splice(index, 1);
				else console.warn('Handler not found');
			},
			selectPhrase: () => {
				console.warn('selectPhrase is not implemented yet');
				return Promise.resolve();
			},
		}),
		[],
	);

	const docUpdated = (docContext: DocContext) => {
		docContextRef.current = docContext;
		handleSelectionChange();
	};

	const getInitialState = () => {
		if (typeof window === 'undefined') return undefined;
		return localStorage.getItem('doc') || undefined;
	};

	return (
		<div className={classes.container}>
			<div className={classes.editor}>
				<LexicalEditor
					// @ts-expect-error initialState needs to actually be `undefined`, not null, see https://github.com/facebook/lexical/issues/5079
					initialState={getInitialState()}
					updateDocContext={docUpdated}
					storageKey="doc"
				/>
			</div>

			<div className={classes.sidebar}>
				<EditorContext.Provider value={editorAPI}>
					<App />
				</EditorContext.Provider>
			</div>
		</div>
	);
}
