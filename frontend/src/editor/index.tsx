import { useRef, useState, StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { OverallMode, overallModeAtom } from '@/contexts/pageContext';

import * as SidebarInner from '@/pages/app';
import type { Auth0ContextInterface } from '@auth0/auth0-react';
import { useAtomValue, useSetAtom } from 'jotai';
import LexicalEditor from './editor';
import './styles.css';
import classes from './styles.module.css';
import { log } from '@/api';
import { usernameAtom } from '@/contexts/userContext';
import { StudyRouter } from './studyRouter';
import { EditorContext } from '@/contexts/editorContext';

function Sidebar() {
	return <SidebarInner.default />;
}

export function EditorScreen({
	taskID,
	editorPreamble,
	contextData,
	falseContextData,
}: {
	taskID?: string;
	editorPreamble?: JSX.Element;
	contextData?: ContextSection[];
	falseContextData?: ContextSection[];
}) {
	const mode = useAtomValue(overallModeAtom);
	const username = useAtomValue(usernameAtom);
	const isDemo = mode === OverallMode.demo;
	const isStudy = mode === OverallMode.study;

	// This is a reference to the current document context
	const docContextRef = useRef<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	});

	// Since this is a list, a useState would have worked as well
	const selectionChangeHandlers = useRef<(() => void)[]>([]);

	// Add word count state for demo mode
	const [wordCount, setWordCount] = useState<number>(0);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach((handler) => { handler(); });
	};

	const editorAPI: EditorAPI = useMemo(() => ({
		doLogin: async (auth0Client: Auth0ContextInterface) => {
			try {
				await auth0Client.loginWithPopup();
			} catch (error) {

				console.error('auth0Client.loginWithPopup Error:', error);
			}
		},
		doLogout: async (auth0Client: Auth0ContextInterface) => {
			try {
				await auth0Client.logout({
					logoutParams: {
						returnTo: `${location.origin}/editor.html`,
					},
				});
			} catch (error) {

				console.error('auth0Client.logout Error:', error);
			}
		},
		getDocContext: async (): Promise<DocContext> => {
			return Promise.resolve(docContextRef.current);
		},
		addSelectionChangeHandler: (handler: () => void) => {
			selectionChangeHandlers.current.push(handler);
		},
		removeSelectionChangeHandler: (handler: () => void) => {
			const index = selectionChangeHandlers.current.indexOf(handler);

			if (index !== -1) selectionChangeHandlers.current.splice(index, 1);

			else console.warn('Handler not found');
		},

		selectPhrase(_text) {
			console.warn('selectPhrase is not implemented yet');
			return new Promise<void>((resolve) => resolve());
		},
	}), []);

	const docUpdated = (docContext: DocContext) => {
		docContextRef.current = docContext;

		if (contextData) {
			docContext.contextData = contextData;
		}
		if (falseContextData) {
			docContext.falseContextData = falseContextData;
		}

		// Log the document update only for study purposes
		if (mode === OverallMode.study && username) {
			log({
				username: username,
				event: 'Document Update',
				currentDocumentState: docContext,
			});
		}

		// Calculate word count
		const fullText =
			docContext.beforeCursor +
			docContext.selectedText +
			docContext.afterCursor;
		const words = fullText
			.trim()
			.split(/\s+/)
			.filter((word) => word.length > 0);
		const newWordCount = words.length;
		setWordCount(newWordCount);

		handleSelectionChange();
	};

	//Determine storage keys based on the task
	const getStorageKey = () => {
		return taskID ? `doc-${taskID}` : 'doc';
	};

	const getInitialState = () => {
		const storageKey = getStorageKey();

		// if (taskPrompt) {
		// 	localStorage.removeItem(storageKey);
		// 	localStorage.removeItem(`${storageKey}-date`);
		// 	return createInitialState(taskPrompt);
		// }
		return localStorage.getItem(storageKey) || undefined;
	};

	return (
		<div className={isDemo ? classes.democontainer : classes.container}>
			<div className={isDemo ? classes.demoeditor : classes.editor}>
				<LexicalEditor
					// @ts-expect-error initialState needs to actually be `undefined`, not null, see see https://github.com/facebook/lexical/issues/5079
					initialState={getInitialState()}
					updateDocContext={docUpdated}
					storageKey={getStorageKey()}
					preamble={editorPreamble}
					enableAutocomplete={isDemo}
					username={username}
				/>
				{isDemo || isStudy ? (
					<div className={`${classes.wordCount}`}>
						Words: {wordCount}
					</div>
				) : null}
			</div>

			<div
				className={isDemo ? classes.demosidebar : classes.sidebar}
			>
				<EditorContext.Provider value={editorAPI}>
					<Sidebar />
				</EditorContext.Provider>
			</div>
		</div>
	);
}

function Router({ page }: { page: string }) {
	const setOverallMode = useSetAtom(overallModeAtom);
	if (page === 'editor') {
		setOverallMode(OverallMode.full);
		return <EditorScreen />;
	} else if (page === 'demo') {
		setOverallMode(OverallMode.demo);
		return <EditorScreen />;
	} else if (page.startsWith('study')) {
		setOverallMode(OverallMode.study);
		return <StudyRouter page={page} />;
	} else {
		return <div>Page not found</div>;
	}
}

const urlParams = new URLSearchParams(window.location.search);
const page = urlParams.get('page');

const container = document.getElementById('container');
if (container) {
	const root = createRoot(container);
	root.render(
		<StrictMode>
			<Router page={page || 'editor'} />
		</StrictMode>,
	);
}
