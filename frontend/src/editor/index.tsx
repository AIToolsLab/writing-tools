import { useRef } from 'react';
import ReactDOM from 'react-dom';

//import Draft from '@/pages/draft';
import * as SidebarInner from '@/pages/app';

import LexicalEditor from './editor';

import PageContextWrapper from '../contexts/pageContext';
import UserContextWrapper from '../contexts/userContext';
import ChatContextWrapper from '../contexts/chatContext';

import classes from './styles.module.css';
import { Auth0ContextInterface } from '@auth0/auth0-react';

function Sidebar({ editorAPI }: { editorAPI: EditorAPI }) {
	return (
		<SidebarInner.default editorAPI={ editorAPI }/>
	);
}

function App() {
	// Needs to be a ref so that we can use docRef.current in the editorAPI
	const docRef = useRef('');

	// Since this is a list, a useState would have worked as well
	const selectionChangeHandlers = useRef<(() => void)[]>([]);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach(handler => handler());
	};

	const editorAPI: EditorAPI = {
		doLogin: async (auth0Client: Auth0ContextInterface) => {
			await auth0Client.loginWithPopup();
		},
		getDocContext: async (_positionalSensitivity: boolean) => {
			return docRef.current;
		},
		getCursorPosInfo: async () => {
			const doc = docRef.current;

			return { charsToCursor: doc.length, docLength: doc.length };
		},
		addSelectionChangeHandler: (handler: () => void) => {
			selectionChangeHandlers.current.push(handler);
		},
		removeSelectionChangeHandler: (handler: () => void) => {
			const index = selectionChangeHandlers.current.indexOf(handler);

			if (index !== -1) selectionChangeHandlers.current.splice(index, 1);
			// eslint-disable-next-line no-console
			else console.warn('Handler not found');
		}
	};

	const docUpdated = (content: string) => {
		docRef.current = content;

		handleSelectionChange();
	};

	return (
		<div className={ classes.container }>
			<div className={ classes.editor }>
				<LexicalEditor
					initialState={ localStorage.getItem('doc') || null }
					updateTextBeforeCursor={ docUpdated }
				/>
			</div>

			<div>last revision: {  localStorage.getItem('doc-date')|| ''  }</div>
			<div className={ classes.sidebar }>
				<Sidebar editorAPI={ editorAPI } />
			</div>
		</div>
	);
}

ReactDOM.render(<App />, document.getElementById('container'));