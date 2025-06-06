import { useRef, useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Auth0ContextInterface } from '@auth0/auth0-react';
import * as SidebarInner from '@/pages/app';
import LexicalEditor from './editor';
import classes from './styles.module.css';
import './styles.css';


// Interface for editor props
interface EditorProps {
  isDemo?: boolean;
}

function Sidebar({ editorAPI, demoMode }: { editorAPI: EditorAPI, demoMode: boolean }) {
	return (
		<SidebarInner.default editorAPI={ editorAPI } demoMode={ demoMode } />
	);
}

function App(props: EditorProps) {
	const isDemo = props.isDemo || false;

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
				<Sidebar editorAPI={ editorAPI } demoMode={ isDemo } />
			</div>
		</div>
	);
}

// Parse URL parameters and render App with appropriate props
const urlParams = new URLSearchParams(window.location.search);
const isDemo = urlParams.get('isDemo') === 'true';

ReactDOM.render(
  <App
    isDemo={ isDemo }
  />,
  document.getElementById('container')
);
