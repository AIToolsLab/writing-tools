import {
	$getRoot,
	$getSelection,
	$isRangeSelection,
	LexicalNode
} from 'lexical';

import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import {
	InitialEditorStateType,
	LexicalComposer
} from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';

import classes from './editor.module.css';

function $getTextBeforeCursor() {
	const selection = $getSelection();

	if (!$isRangeSelection(selection)) return '';

	const anchor = selection.anchor;
	const anchorNode = anchor.getNode();
	let anchorOffset = anchor.offset;

	const currentNodeText = anchorNode.getTextContent();

	// If anchorOffset is mid-word, extend it to the end of the word.
	// Use a regular expression to find an end-of-word boundary.
	if (anchorOffset < currentNodeText.length) {
		const wordEnd = /(\W|$)/.exec(currentNodeText.slice(anchorOffset));

		if (wordEnd) anchorOffset += wordEnd.index;
	}

	let textBeforeCursor = currentNodeText.slice(0, anchorOffset);

	// Get text from previous siblings and their descendants
	let currentNode: LexicalNode = anchorNode;
	let prevNode: LexicalNode | null;

	while ((prevNode = currentNode.getPreviousSibling())) {
		currentNode = prevNode;
		if (currentNode.getType() === 'paragraph')
			textBeforeCursor = '\n\n' + textBeforeCursor;
		else if (currentNode.getType() === 'linebreak')
			textBeforeCursor = '\n' + textBeforeCursor;

		textBeforeCursor = currentNode.getTextContent() + textBeforeCursor;
	}

	// Traverse up the tree and get text from previous siblings
	let parent = anchorNode.getParent();

	while (parent) {
		let sibling: LexicalNode = parent;
		let nextSibling: LexicalNode | null;

		while ((nextSibling = sibling.getPreviousSibling())) {
			if (sibling.getType() === 'paragraph')
				textBeforeCursor = '\n\n' + textBeforeCursor;

			sibling = nextSibling;
			textBeforeCursor = sibling.getTextContent() + textBeforeCursor;
		}

		parent = parent.getParent();
	}

	return textBeforeCursor;
}

function LexicalEditor({
	updateTextBeforeCursor,
	initialState
}: {
	updateTextBeforeCursor: (text: string) => void;
	initialState: InitialEditorStateType | null;
}) {
	return (
		<>
			<LexicalComposer // Main editor component
				initialConfig={ {
					namespace: 'essay',
					theme: {
						paragraph: classes.paragraph
					},
					onError(_error, _editor) {},
					editorState: initialState
				} }
			>
				<div className={ classes.editorContainer }>
					<RichTextPlugin
						contentEditable={
							<ContentEditable className={ classes.editor } />
						}
						placeholder={ <div className={ classes.placeholder } /> }
						ErrorBoundary={ LexicalErrorBoundary }
					/>

					<OnChangePlugin
						onChange={ editorState => {
							editorState.read(() => {
								const textBeforeCursor = $getTextBeforeCursor();

								// eslint-disable-next-line no-console
								console.log(
									'Text before cursor:',
									textBeforeCursor
								);

								// eslint-disable-next-line no-console
								console.log(
									'Full document:',
									$getRoot().getTextContent()
								);

								updateTextBeforeCursor(textBeforeCursor);

								localStorage.setItem(
									'doc',
									JSON.stringify(editorState)
								);

								const currentDate = new Date().toISOString();
								localStorage.setItem(
									'doc-date',
									currentDate
								);
							});
						} }
					/>

					<AutoFocusPlugin />

					<HistoryPlugin />
				</div>
			</LexicalComposer>
		</>
	);
}

export default LexicalEditor;
