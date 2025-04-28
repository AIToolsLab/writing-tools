import { useRef, useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Auth0ContextInterface } from '@auth0/auth0-react';
import * as SidebarInner from '@/pages/app';
import LexicalEditor from './editor';
import classes from './styles.module.css';
import demoClasses from './demo.module.css';

function Sidebar({ editorAPI }: { editorAPI: EditorAPI }) {
	return (
		<SidebarInner.default editorAPI={ editorAPI }/>
	);
}

function App() {
	// This is a reference to the current document context
	const docContextRef = useRef<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: ''
	});

	// Since this is a list, a useState would have worked as well
	const selectionChangeHandlers = useRef<(() => void)[]>([]);

	// Read configuration from window.editorConfig (set in editor.html)
	const isDemo = (window as any).editorConfig?.isDemo || false;
	const wordLimit = (window as any).editorConfig?.wordLimit || null;

	// Add word count state for demo mode
	const [wordCount, setWordCount] = useState<number>(0);
	// Add state to track when word count exceeds limit
	const [isOverLimit, setIsOverLimit] = useState<boolean>(false);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach(handler => handler());
	};

	// Add effect to prevent input when word count exceeds limit (only in demo mode)
	useEffect(() => {
		if (!isDemo || !wordLimit) return;

		// Find editor element, accounting for different class names in demo vs regular mode
		const editorSelector = isDemo ? `.${demoClasses.editor}` : `.${classes.editor}`;
		const editorElement = document.querySelector(editorSelector);
		if (!editorElement) return;

		// Function to handle input events
		const handleBeforeInput = (event: Event) => {
			const inputEvent = event as InputEvent;
			if (isOverLimit && (
				inputEvent.inputType === 'insertText' ||
				inputEvent.inputType === 'insertFromPaste' ||
				inputEvent.inputType.startsWith('insert')
			)) {
				event.preventDefault();
			}
		};

		// Add event listener
		editorElement.addEventListener('beforeinput', handleBeforeInput);

		// Update visual feedback when over limit
		if (isOverLimit) {
			editorElement.classList.add(demoClasses.overLimit);
		}
		else {
			editorElement.classList.remove(demoClasses.overLimit);
		}

		// Clean up when component unmounts
		return () => {
			editorElement.removeEventListener('beforeinput', handleBeforeInput);
		};
	}, [isDemo, wordLimit, isOverLimit]);

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

		// Calculate word count for demo mode with word limit
		if (isDemo && wordLimit) {
			const fullText = docContext.beforeCursor + docContext.selectedText + docContext.afterCursor;
			const words = fullText.trim().split(/\s+/).filter(word => word.length > 0);
			const newWordCount = words.length;
			setWordCount(newWordCount);

			// Check if word count exceeds limit
			setIsOverLimit(newWordCount > wordLimit);
		}

		handleSelectionChange();
	};

	return (
		<div className={ isDemo ? demoClasses.container : classes.container }>
			<div className={ isDemo ? demoClasses.editor : classes.editor }>
				<LexicalEditor
					initialState={ localStorage.getItem('doc') || null }
					updateDocContext={ docUpdated }
				/>
				{ isDemo && wordLimit && (
					<div className={ `${demoClasses.wordCount} ${isOverLimit ? demoClasses.wordCountLimit : ''}` }>
						Words: { wordCount }/{ wordLimit }
					</div>
				) }
			</div>

			<div className={ isDemo ? demoClasses.sidebar : classes.sidebar }>
				<Sidebar editorAPI={ editorAPI } />
			</div>
		</div>
	);
}

ReactDOM.render(<App />, document.getElementById('container'));
