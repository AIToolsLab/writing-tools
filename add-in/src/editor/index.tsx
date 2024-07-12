import * as React from 'react';
import * as ReactDOM from 'react-dom';

import classes from './styles.module.css';
import QvE from '@/pages/qve';

type EditorProps = {
	onInput: () => void;
};

const Editor = React.forwardRef(function Editor(
	{ onInput }: EditorProps,
	ref: React.Ref<HTMLDivElement>
) {
	return (
		<div
			className={classes.editor}
			ref={ref}
			contentEditable={true}
			onInput={onInput}
		/>
	);
});

function App() {
	const editorRef = React.useRef(null);

    // needs to be a ref so that we can use docRef.current in the editorAPI
    const docRef = React.useRef('');

	// since this is a list, a useState would have worked as well
	const selectionChangeHandlers = React.useRef<(() => void)[]>([]);

	const handleSelectionChange = () => {
		selectionChangeHandlers.current.forEach(handler => handler());
	};

	const editorAPI: EditorAPI = {
		getDocContext: async (positionalSensitivity: boolean) => {
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
			if (index !== -1) {
				selectionChangeHandlers.current.splice(index, 1);
			} else {
				console.warn('Handler not found');
			}
		}
	};

	const docUpdated = () => {
		if (editorRef.current) {
			const content = (editorRef.current as HTMLElement).innerHTML;
			console.log(content);
			docRef.current = content;
			handleSelectionChange();
		}
	};

	return (
		<div className={classes.container}>
			<div className={classes.editorContainer}>
				<Editor
					ref={editorRef}
					onInput={docUpdated}
				/>
			</div>
			<div className={classes.sidebar}>
				<QvE editorAPI={editorAPI} />
			</div>
		</div>
	);
}

ReactDOM.render(<App />, document.getElementById('container'));
