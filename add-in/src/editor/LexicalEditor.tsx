import {AutoFocusPlugin} from '@lexical/react/LexicalAutoFocusPlugin';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { $getRoot, $getSelection, $isRangeSelection, LexicalNode } from 'lexical';

function $getTextBeforeCursor() {
	const selection = $getSelection();

	if (!$isRangeSelection(selection)) {
		return '';
	}

	const anchor = selection.anchor;
	const anchorNode = anchor.getNode();
	const anchorOffset = anchor.offset;

	let textBeforeCursor = '';

	// Get text from previous siblings and their descendants
	let currentNode: LexicalNode = anchorNode;
	let prevNode: LexicalNode | null;
	while ((prevNode = currentNode.getPreviousSibling())) {
		currentNode = prevNode;
		textBeforeCursor = currentNode.getTextContent() + textBeforeCursor;
	}

	// Traverse up the tree and get text from previous siblings
	let parent = anchorNode.getParent();
	while (parent) {
		let sibling = parent.getPreviousSibling();
		while (sibling) {
			textBeforeCursor = sibling.getTextContent() + textBeforeCursor;
			sibling = sibling.getPreviousSibling();
		}
		parent = parent.getParent();
	}

	// Add text from the current node up to the cursor
	textBeforeCursor += anchorNode.getTextContent().slice(0, anchorOffset);

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
                contentEditable={<ContentEditable placeholder={'Enter some text...'} />}
                placeholder={null}
                ErrorBoundary={LexicalErrorBoundary}
            />
            <HistoryPlugin />
            <OnChangePlugin
                onChange={(editorState) => {
                    editorState.read(() => {
                        const textBeforeCursor = $getTextBeforeCursor();
                        console.log('Text before cursor:', textBeforeCursor);
                        console.log("Full document:", $getRoot().getTextContent());
                        updateTextBeforeCursor(textBeforeCursor);
                    });
                }}
            />
            <AutoFocusPlugin />
        </LexicalComposer>
    );
}

export default LexicalEditor;
