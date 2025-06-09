import { OverallMode, overallModeAtom, PageName, pageNameAtom } from '@/contexts/pageContext';
import { studyConditionAtom, taskDescriptionAtom } from '@/contexts/studyContext';
import * as SidebarInner from '@/pages/app';
import { Auth0ContextInterface } from '@auth0/auth0-react';
import { getDefaultStore, useAtomValue } from 'jotai';
import { useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import LexicalEditor from './editor';
import './styles.css';
import classes from './styles.module.css';



function Sidebar({ editorAPI }: { editorAPI: EditorAPI}) {
	return (
		<SidebarInner.default editorAPI={ editorAPI } />
	);
}

function EditorScreen() {
	const mode = useAtomValue(overallModeAtom)
	const isDemo = mode === OverallMode.demo;

	// This is a reference to the current document context
	const docContextRef = useRef<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: ''
	});

	// Since this is a list, a useState would have worked as well
	const selectionChangeHandlers = useRef<(() => void)[]>([]);

	// Add word count state for demo mode
	const [wordCount, setWordCount] = useState<number>(0);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach(handler => handler());
	};


	const editorAPI: EditorAPI = {
		doLogin: async (auth0Client: Auth0ContextInterface) => {
			try {
				await auth0Client.loginWithPopup();
			}
			catch (error) {
				// eslint-disable-next-line no-console
				console.error('auth0Client.loginWithPopup Error:', error);
			}
		},
		doLogout: async (auth0Client: Auth0ContextInterface) => {
			try {
				await auth0Client.logout(
					{
						logoutParams: {
							returnTo: `${location.origin}/editor.html`
						}
					}
				);
			}
			catch (error) {
				// eslint-disable-next-line no-console
				console.error('auth0Client.logout Error:', error);
			}
		},
		getDocContext: async (): Promise<DocContext> => {
			return docContextRef.current;
		},
		addSelectionChangeHandler: (handler: () => void) => {
			selectionChangeHandlers.current.push(handler);
		},
		removeSelectionChangeHandler: (handler: () => void) => {
			const index = selectionChangeHandlers.current.indexOf(handler);

			if (index !== -1) selectionChangeHandlers.current.splice(index, 1);
			// eslint-disable-next-line no-console
			else console.warn('Handler not found');
		},
	};

	const docUpdated = (docContext: DocContext) => {
		docContextRef.current = docContext;

		// Calculate word count
		const fullText = docContext.beforeCursor + docContext.selectedText + docContext.afterCursor;
		const words = fullText.trim().split(/\s+/).filter(word => word.length > 0);
		const newWordCount = words.length;
		setWordCount(newWordCount);

		handleSelectionChange();
	};

	return (
		<div className={ isDemo ? classes.democontainer : classes.container }>

			<div className={ isDemo ? classes.demoeditor : classes.editor }>
				<LexicalEditor
					//@ts-ignore, see https://github.com/facebook/lexical/issues/5079
					initialState={ localStorage.getItem('doc') || undefined }
					updateDocContext={ docUpdated }
				/>
				{ isDemo && (
					<div className={ `${classes.wordCount}` }>
						Words: { wordCount }
					</div>
				) }
			</div>

			<div className={ isDemo ? classes.demosidebar : classes.sidebar }>
				<Sidebar editorAPI={ editorAPI } />
			</div>
		</div>
	);
}

function Router({
	page
}: {
	page: string;
}) {

	if (page === 'editor') {
		getDefaultStore().set(overallModeAtom, OverallMode.full);
		return <EditorScreen />;
	}
	else if (page === 'demo') {
		getDefaultStore().set(overallModeAtom, OverallMode.demo);
		return <EditorScreen />;
	}
	else if (page.startsWith('study')) {
		getDefaultStore().set(pageNameAtom, PageName.Study);
		getDefaultStore().set(overallModeAtom, OverallMode.study);
		if (page === 'study-intro') {
			return <div className={classes.studyIntroContainer}>
            <h1>Welcome!</h1>
            <p>
							Thank you for participating in our writing study. You'll complete three writing tasks (about 200-250 words each) on different topics.
							After completing each task, click 'Done' to save your work and continue to the next task.
							As you write, pay attention to the suggestions the writing tool offers and use them when
							they seem helpful. There are no right or wrong ways to interact with the tool.
							Your responses will be kept confidential. You can ask questions at any time.
            </p>
						<button
								onClick={() => window.location.search = '?page=study-task1'}
								className={classes.startButton}
						>
								Start Study
						</button>

        </div>;
		}
		else if (page === 'study-task1') {
			const condition = 'Keywords'; // This would be dynamically set based on the study task
			getDefaultStore().set(studyConditionAtom, condition);
			const taskDescription = 'Should companies adopt a four-day work week (working Monday through Thursday) instead of the traditional five-day schedule? Consider impacts on productivity, employee well-being, and business operations.';
			getDefaultStore().set(taskDescriptionAtom, taskDescription);

			return <div>Study Task 1 Page - Condition: {condition}
				<div> {taskDescription}</div>

				<EditorScreen />

				<button
					onClick={() => window.location.search = '?page=study-task2'}
					className={classes.doneButton}> I'm Done
				</button>

			</div>;
		}
		else if (page === 'study-task2') {
			const condition = 'condition' // This would be dynamically set based on the study task
			getDefaultStore().set(studyConditionAtom, condition);
			const taskDescription = 'description';
			getDefaultStore().set(taskDescriptionAtom, taskDescription);

			return <div>Study Task 2 Page - Condition: {condition}
				<div>
					{taskDescription}</div>
				<EditorScreen />

				<button
					onClick={() => window.location.search = '?page=study-task3'}
					className={classes.doneButton}> I'm Done
				</button>

			</div>;
		}
		else if (page === 'study-task3') {
			const condition = 'condition' // This would be dynamically set based on the study task
			getDefaultStore().set(studyConditionAtom, condition);
			const taskDescription = 'description';
			getDefaultStore().set(taskDescriptionAtom, taskDescription);

			return <div>Study Task 3 Page - Condition: {condition}
				<div>
					{taskDescription}</div>
				<EditorScreen />

				<button
					onClick={() => window.location.search = '?page=study-intro'}
					className={classes.doneButton}> I'm Done
				</button>

			</div>;
		}
		else {
			return <div>Unknown study page</div>;
		}
	}
	else {
		return <div>Page not found</div>;
	}
}

// Parse URL parameters and render App with appropriate props
const urlParams = new URLSearchParams(window.location.search);
const page = urlParams.get('page');

ReactDOM.render(
  <Router
    page = { page || 'editor' }
  />,
  document.getElementById('container')
);
