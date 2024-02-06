import { useState } from 'react';

// #region Lexical Imports
import {
    $getRoot,
    $createRangeSelection
} from 'lexical';

import { $patchStyleText } from '@lexical/selection';

import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';

import LexicalErrorBoundary from '@lexical/react/LexicalErrorBoundary';
// #endregion

import { SERVER_URL } from '../../settings';

import classes from './styles.module.css';

type CommentPluginProps = {
    comment: null | Comment;
    commentIndex: number;
    previousComment: number;
    updatePreviousComment: (_: number) => void;
};

function CommentPlugin(props: CommentPluginProps) {
    const [editor] = useLexicalComposerContext(); // Get the editor instance

    editor.update(() => {
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
            $patchStyleText(selection, { 'background-color': 'none !important' });
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

        // Create selection for the paragraph
        selection.anchor.key = paragraphKey;
        selection.focus.key = (Number(paragraphKey) + 1).toString();

        $patchStyleText(selection, { 'background-color': 'rgba(255, 255, 146, 0.637)' });
    });

    props.updatePreviousComment(props.commentIndex);

    return <></>;
}

type EditorProps = {
    comment: null | Comment;
    commentIndex: number;
    updateComments: (_: Comment[]) => void;
}

export default function Editor(props: EditorProps) {
    // Store previous text state to compare with current state
    const [textState, updateTextState] = useState(''); 
    const [previousComment, updatePreviousComment] = useState(-1);

    return (
        <>
            <LexicalComposer // Main editor component
                initialConfig={
                    {
                        namespace: 'essay',
                        theme: {
                            paragraph: classes.paragraph,
                        },
                        onError(_error, _editor) {},
                    }
                }
            >
                <div className={ classes.editorContainer }>
                    <PlainTextPlugin // Create plain text editor
                        contentEditable={
                            <ContentEditable className={ classes.editor } />
                        }
                        placeholder={ <div className={ classes.placeholder } /> }
                        ErrorBoundary={ LexicalErrorBoundary }
                    />

                    <OnChangePlugin // On change handler
                        onChange={
                            (editorState) => {
                                editorState.read(() => {
                                    const root = $getRoot(); // Get root node of the editor (parent to all text nodes)

                                    const fullText = root.getTextContent(); 
                                    const paragraphs = root
                                        .getAllTextNodes()
                                        .map(node => node.getTextContent());

                                    // If there isn't a change in the text
                                    if (fullText === textState) return;
                                    
                                    // Update text state to current state
                                    updateTextState(fullText);

                                });
                            }
                        }
                    />

                    <HistoryPlugin />

                    {/* Custom plugin to handle comments */}
                    <CommentPlugin
                        previousComment={ previousComment }
                        updatePreviousComment={ updatePreviousComment }
                        comment={ props.comment }
                        commentIndex={ props.commentIndex }
                    />
                </div>
            </LexicalComposer>
        </>
    );
}
