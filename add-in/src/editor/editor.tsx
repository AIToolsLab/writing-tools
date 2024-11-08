import { useState } from 'react';

import {
	$getRoot,
	$getSelection,
	$isRangeSelection,
    $createRangeSelection,
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
        console.log(props.commentIndex, props.comment);

        // Remove all highlighting from the editor
        (function clearStyles() {
            const selection = $createRangeSelection(); // Create a selection of text nodes
            
            // A map of all of the nodes in the editor
            const nodeMap = editor.getEditorState()._nodeMap;

            const textNodeKeys: string[] = []; // List of keys of all text nodes

            // Get all text nodes
            nodeMap.forEach(
                (node, _) => {
                    // If the node isn't a text node, then skip it
                    if(node.getType() !== 'text') return;
                    
                    textNodeKeys.push(node.getKey());
                }
            );

            // If the editor is empty
            if(textNodeKeys.length === 0) return;
            
            // Adjust the selection to be the first and last text nodes (selecting the entire editor)
            selection.focus.key = textNodeKeys[0];
            selection.anchor.key = (Number(textNodeKeys[textNodeKeys.length - 1]) + 1).toString();
                        
            // Remove all background styles from the selection
            console.log($patchStyleText(selection, { 'background-color': 'transparent' }), 'dassa');
        })();

        if(!props.comment || props.commentIndex < 0) return;

        // Create a selection for the paragraph that the comment is for
        const selection = $createRangeSelection();
        const nodeMap = editor.getEditorState()._nodeMap;

        // The key of the first node in the paragraph
        let paragraphKey = '';
        
        // Paragraph index in the editor
        let count = 0;

        nodeMap.forEach(
            (k, _) => {
                const node = k;

                if(node.getType() !== 'text') return;
                
                // If the current paragraph is the one that the comment is for
                if(count === props.commentIndex)
                    paragraphKey = node.getKey();
                
                count++;
            }
        );

        console.log(count);

        // Create selection for the paragraph
        selection.anchor.key = paragraphKey;
        selection.focus.key = (Number(paragraphKey) + 1).toString();

        $patchStyleText(selection, { 'background-color': 'rgba(255, 255, 146, 0.637)' });
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
