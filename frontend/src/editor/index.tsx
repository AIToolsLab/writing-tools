import { useCallback, useRef, useState, StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { localStorageDocumentSettings } from '@/api/documentSettings';
import { OverallMode, overallModeAtom } from '@/contexts/pageContext';

import * as SidebarInner from '@/pages/app';
import { useAtomValue, useSetAtom } from 'jotai';
import LexicalEditor, { type EditorControls } from './editor';
import '../preflight.css';
import classes from './styles.module.css';
import { EditorContext } from '@/contexts/editorContext';
import { lowerOp } from '@/pages/my-words/interaction/ops';
import type { EditOp } from '@/pages/my-words/interaction/types';

function Sidebar() {
	return <SidebarInner.default />;
}

export function EditorScreen({
	taskID,
	editorPreamble,
	contextData,
}: {
	taskID?: string;
	editorPreamble?: React.JSX.Element;
	contextData?: ContextSection[];
}) {
	const mode = useAtomValue(overallModeAtom);
	const isDemo = mode === OverallMode.demo;

	// Identifies "this document" for both the Lexical draft and the sidebar's
	// document settings, so a per-task editor keeps its own brief.
	const storageKey = taskID ? `doc-${taskID}` : 'doc';

	// This is a reference to the current document context
	const docContextRef = useRef<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	});

	// Imperative handle into the Lexical document, populated once it mounts.
	const controlsRef = useRef<EditorControls | null>(null);
	const handleEditorReady = useCallback((controls: EditorControls) => {
		controlsRef.current = controls;
	}, []);

	// Since this is a list, a useState would have worked as well
	const selectionChangeHandlers = useRef<(() => void)[]>([]);

	// Add word count state for demo mode
	const [wordCount, setWordCount] = useState<number>(0);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach((handler) => {
			handler();
		});
	};

	const editorAPI: EditorAPI = useMemo(
		() => ({
			getDocContext: async (): Promise<DocContext> => {
				return Promise.resolve({
					...docContextRef.current,
					documentLabel:
						docContextRef.current.documentLabel ??
						'Standalone editor draft',
				});
			},
			addSelectionChangeHandler: (handler: () => void) => {
				selectionChangeHandlers.current.push(handler);
			},
			removeSelectionChangeHandler: (handler: () => void) => {
				const index = selectionChangeHandlers.current.indexOf(handler);

				if (index !== -1)
					selectionChangeHandlers.current.splice(index, 1);
				else console.warn('Handler not found');
			},

			selectPhrase(text) {
				const found = controlsRef.current?.selectPhrase(text) ?? false;
				return found
					? Promise.resolve()
					: Promise.reject(new Error('Phrase not found'));
			},
			getDocText: (): Promise<string> => {
				return Promise.resolve(controlsRef.current?.getText() ?? '');
			},
			getParagraphs: (): Promise<string[]> => {
				return Promise.resolve(
					controlsRef.current?.getParagraphs() ?? [],
				);
			},
			applyEdit: (edit: DocEdit): Promise<void> => {
				const controls = controlsRef.current;
				if (!controls) {
					return Promise.reject(new Error('Editor is not ready yet'));
				}
				// Lower to paragraph-range splices and apply them node-by-node —
				// never a whole-document rewrite (setText), which would destroy the
				// cursor, collapse undo, and double paragraph breaks.
				const paras = controls.getParagraphs();
				if (edit.type === 'delete_paragraph') {
					if (edit.paragraph < 1 || edit.paragraph > paras.length) {
						return Promise.reject(
							new Error(
								`Paragraph ${edit.paragraph} is out of range (1–${paras.length}).`,
							),
						);
					}
					controls.applySplice({
						index: edit.paragraph - 1,
						remove: [paras[edit.paragraph - 1]],
						insert: [],
					});
					return Promise.resolve();
				}
				const op: EditOp =
					edit.type === 'str_replace'
						? {
								kind: 'str_replace',
								oldStr: edit.oldStr,
								newStr: edit.newStr,
								paragraph: edit.paragraph,
							}
						: {
								kind: 'insert',
								text: edit.text,
								after: edit.after,
								paragraph: edit.paragraph,
								position: edit.position,
							};
				try {
					for (const splice of lowerOp(paras, op)) {
						controls.applySplice(splice);
					}
				} catch (e) {
					return Promise.reject(e as Error);
				}
				return Promise.resolve();
			},
			applySplice: (splice: ParagraphSplice): Promise<void> => {
				const controls = controlsRef.current;
				if (!controls) {
					return Promise.reject(new Error('Editor is not ready yet'));
				}
				controls.applySplice(splice);
				return Promise.resolve();
			},
			// There is no host document here to embed settings in, so they live
			// in localStorage under this editor's own document key.
			...localStorageDocumentSettings(storageKey),
		}),
		[storageKey],
	);

	const docUpdated = (docContext: DocContext) => {
		docContextRef.current = docContext;

		if (contextData) {
			docContext.contextData = contextData;
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

	const getInitialState = () => {
		// if (taskPrompt) {
		// 	localStorage.removeItem(storageKey);
		// 	localStorage.removeItem(`${storageKey}-date`);
		// 	return createInitialState(taskPrompt);
		// }
		return localStorage.getItem(storageKey) || undefined;
	};

	return (
		<>
			{isDemo ? (
				<div className={classes.demoDisclosure}>
					All demo usage is logged. Demo may be unavailable during
					times of high usage.
				</div>
			) : null}
			<div className={isDemo ? classes.democontainer : classes.container}>
				<div className={isDemo ? classes.demoeditor : classes.editor}>
					<LexicalEditor
						initialState={getInitialState()}
						updateDocContext={docUpdated}
						storageKey={storageKey}
						preamble={editorPreamble}
						onReady={handleEditorReady}
					/>
					{isDemo ? (
						<div className={`${classes.wordCount}`}>
							Words: {wordCount}
						</div>
					) : null}
				</div>

				<div className={isDemo ? classes.demosidebar : classes.sidebar}>
					<EditorContext.Provider value={editorAPI}>
						<Sidebar />
					</EditorContext.Provider>
				</div>
			</div>
		</>
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
