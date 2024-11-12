import { useState } from 'react';

import {
	$getRoot,
	$getSelection,
	$isRangeSelection,
    $createRangeSelection,
    $isTextNode,
    $setSelection,
	LexicalNode
} from 'lexical';

import { $patchStyleText } from '@lexical/selection';

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

import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

import classes from './editor.module.css';

type CommentPluginProps = {
    comment: null | TextComment;
    commentIndex: number;
    previousComment: number;
    updatePreviousComment: (_: number) => void;
};

function CommentPlugin(props: CommentPluginProps) {
    const [editor] = useLexicalComposerContext(); // Get the editor instance

    editor.update(() => {
        // Remove all highlighting from the editor
        (function clearStyles() {
            const selection = $createRangeSelection();
            const nodes = $getRoot().getAllTextNodes();

            selection.focus.set(nodes[0].getKey(), 0, 'text');
            selection.anchor.set(nodes[nodes.length - 1].getKey(), nodes[nodes.length - 1].getTextContentSize(), 'text');
            $setSelection(selection);

            console.log(selection);

            // Remove all background styles from the selection
            $patchStyleText(selection, { 'background-color': 'transparent' });

            $setSelection($createRangeSelection());
        })();

        if(!props.comment || props.commentIndex < 0) return;

        // Create a selection for the paragraph that the comment is for
        const selection = $createRangeSelection();

        const nodes = $getRoot().getAllTextNodes()[props.commentIndex];

        if($isTextNode(nodes)) {
            selection.focus.set(nodes.getKey(), 0, 'text');
            selection.anchor.set(nodes.getKey(), nodes.getTextContentSize(), 'text');
        }

        $patchStyleText(selection, { 'background-color': 'rgba(255, 255, 146, 0.637)' });
        $setSelection($createRangeSelection());
    });

    // props.updatePreviousComment(props.commentIndex);

    return <></>;
}

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

type EditorProps = {
    comment: null | TextComment;
    commentIndex: number;
    updateComments: (_: TextComment[]) => void;
    updateTextBeforeCursor: (text: string) => void;
	initialState: InitialEditorStateType | null;
}

function LexicalEditor(props: EditorProps) {
    const [previousComment, updatePreviousComment] = useState(-1);

	return (
		<>
			<LexicalComposer // Main editor component
				initialConfig={ {
					namespace: 'essay',
					theme: {
						paragraph: classes.paragraph
					},
					onError(_error, _editor) {},
					editorState: props.initialState
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

								props.updateTextBeforeCursor(textBeforeCursor);

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
                    
                    <CommentPlugin
                        previousComment={ previousComment }
                        updatePreviousComment={ updatePreviousComment }
                        comment={ props.comment }
                        commentIndex={ props.commentIndex }
                    />

					<AutoFocusPlugin />

					<HistoryPlugin />
				</div>
			</LexicalComposer>
		</>
	);
}

export default LexicalEditor;
