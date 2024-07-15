import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import {
	$getRoot,
	$getSelection,
	$isRangeSelection,
	LexicalNode
} from 'lexical';

function $getTextBeforeCursor() {
	const selection = $getSelection();

	if (!$isRangeSelection(selection)) {
		return '';
	}

	const anchor = selection.anchor;
	const anchorNode = anchor.getNode();
	let anchorOffset = anchor.offset;

	let currentNodeText = anchorNode.getTextContent();
	// If anchorOffset is mid-word, extend it to the end of the word.
	// Use a regular expression to find an end-of-word boundary.
	if (anchorOffset < currentNodeText.length) {
		const wordEnd = /(\W|$)/.exec(currentNodeText.slice(anchorOffset));
		if (wordEnd) {
			anchorOffset += wordEnd.index;
		}
	}
	let textBeforeCursor = currentNodeText.slice(0, anchorOffset);

	// Get text from previous siblings and their descendants
	let currentNode: LexicalNode = anchorNode;
	let prevNode: LexicalNode | null;
	while ((prevNode = currentNode.getPreviousSibling())) {
		currentNode = prevNode;
		if (currentNode.getType() === 'paragraph') {
			textBeforeCursor = '\n\n' + textBeforeCursor;
		} else if (currentNode.getType() === 'linebreak') {
			textBeforeCursor = '\n' + textBeforeCursor;
		}
		textBeforeCursor =
			currentNode.getTextContent() + textBeforeCursor;
	}
	
	// Traverse up the tree and get text from previous siblings
	let parent = anchorNode.getParent();
	while (parent) {
		let sibling: LexicalNode = parent;
		let nextSibling: LexicalNode | null;
		while (nextSibling = sibling.getPreviousSibling()) {
			if (sibling.getType() === 'paragraph') {
				textBeforeCursor = '\n\n' + textBeforeCursor;
			}
			sibling = nextSibling;
			textBeforeCursor = sibling.getTextContent() + textBeforeCursor;
		}
		parent = parent.getParent();
	}


	return textBeforeCursor;
}

function LexicalEditor({
	updateTextBeforeCursor
}: {
	updateTextBeforeCursor: (text: string) => void;
}) {
	const initialConfig = {
		namespace: 'MyEditor',
		onError: (error: any) => console.error(error)
	};

	return (
		<LexicalComposer initialConfig={initialConfig}>
			<RichTextPlugin
				contentEditable={
					<ContentEditable placeholder={'Enter some text...'} />
				}
				placeholder={null}
				ErrorBoundary={LexicalErrorBoundary}
			/>
			<HistoryPlugin />
			<OnChangePlugin
				onChange={editorState => {
					editorState.read(() => {
						const textBeforeCursor = $getTextBeforeCursor();
						console.log('Text before cursor:', textBeforeCursor);
						console.log(
							'Full document:',
							$getRoot().getTextContent()
						);
						updateTextBeforeCursor(textBeforeCursor);
					});
				}}
			/>
			<AutoFocusPlugin />
			
		</LexicalComposer>
	);
}

export default LexicalEditor;
