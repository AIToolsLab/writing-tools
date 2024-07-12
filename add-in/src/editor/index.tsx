import * as React from 'react';
import * as ReactDOM from 'react-dom';

import classes from './styles.module.css';

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
    const [doc, setDoc] = React.useState('');

	const docUpdated = () => {
		if (editorRef.current) {
			const content = (editorRef.current as HTMLElement).innerHTML;
			console.log(content);
            setDoc(content)
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
			<div className={classes.sidebar}>{doc}</div>
		</div>
	);
}

ReactDOM.render(<App />, document.getElementById('container'));
