import { useRef } from 'react';
import ReactDOM from 'react-dom';

import classes from './styles.module.css';
import QvE from '@/pages/qve';
import LexicalEditor from './editor';

function App() {
    // needs to be a ref so that we can use docRef.current in the editorAPI
    const docRef = useRef('');

	// since this is a list, a useState would have worked as well
	const selectionChangeHandlers = useRef<(() => void)[]>([]);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach(handler => handler());
	};

	const editorAPI: EditorAPI = {
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
			
            if (index !== -1)
				selectionChangeHandlers.current.splice(index, 1);
			else
                // eslint-disable-next-line no-console
				console.warn('Handler not found');
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
                    initialState={ localStorage.getItem('doc') || '' }
                    updateTextBeforeCursor={ docUpdated }
                />
            </div>

			<div className={ classes.sidebar }>
				<QvE editorAPI={ editorAPI } />
			</div>
		</div>
	);
}

ReactDOM.render(<App />, document.getElementById('container'));
