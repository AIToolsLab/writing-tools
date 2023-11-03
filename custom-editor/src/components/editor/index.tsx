import { useState } from 'react';
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

import { SERVER_URL } from '../../settings';

import classes from './styles.module.css';

const theme = {
    paragraph: classes.paragraph,
};

function Placeholder() {
    return <div className={ classes.placeholder }></div>;
}

function CommentPlugin(props: { focused: null | Card; focusedIndex: number | null; }) {
    const [editor] = useLexicalComposerContext();

    editor.update(() => {
        (function clearStyles() {
            const selection = $createRangeSelection();
            const nodeMap = editor.getEditorState()._nodeMap;

            const keys: string[] = [];

            nodeMap.forEach(
                (k, _v) => {
                    const node = k;

                    if(node.getType() !== 'text') return;

                    keys.push(node.getKey());
                }
            );

            if(keys.length === 0) return;

            selection.anchor.key = keys[0];
            selection.focus.key = keys[keys.length - 1];
            $patchStyleText(selection, { 'background-color': 'none' });
        })();

        if(!props.focused || props.focusedIndex === null) return;

        const selection = $createRangeSelection();
        const nodeMap = editor.getEditorState()._nodeMap;

        let paragraphKey: string = '';
        let count = 0;

        nodeMap.forEach(
            (k, _v) => {
                const node = k;

                if(node.getType() !== 'text') return;
                if(count === props.focusedIndex) paragraphKey = node.getKey();
                
                count++;
            }
        );

        selection.anchor.key = paragraphKey;
        selection.focus.key = (Number(paragraphKey) + 1).toString();

        $patchStyleText(selection, { 'background-color': 'rgba(255, 255, 146, 0.637)' });
    });

    return <></>;
}

export default function Editor(props: { focused: null | Card; focusedIndex: number | null; updateCards: (_: Card[]) => void }) {
    let updateSummariesTimeout: NodeJS.Timeout | null = null;

    const textState = useState('');

    return (
        <>
            <LexicalComposer
                initialConfig={ {
                    namespace: 'essay',
                    theme,
                    onError(_error, _editor) {},
                } }
            >
                <div className={ classes.editorContainer }>
                    <PlainTextPlugin
                        contentEditable={
                            <ContentEditable className={ classes.editor } />
                        }
                        placeholder={ <Placeholder /> }
                        ErrorBoundary={ LexicalErrorBoundary }
                    />

                    <OnChangePlugin
                        onChange={ (editorState) => {
                            editorState.read(() => {
                                const root = $getRoot();
                                const fullText = root.getTextContent();
                                const paragraphs = root
                                    .getAllTextNodes()
                                    .map((node) => node.getTextContent());

                                if (fullText === textState[0]) return;

                                textState[0] = fullText;

                                if (updateSummariesTimeout) {
                                    clearTimeout(updateSummariesTimeout);
                                    updateSummariesTimeout = null;
                                }

                                updateSummariesTimeout = setTimeout(async () => {
                                    const responses = await Promise.all(
                                        paragraphs.map((paragraph) => 
                                            fetch(
                                                `${ SERVER_URL }/summarize`,
                                                {
                                                    method: 'POST',
                                                    headers: {
                                                        'Content-Type':
                                                            'application/json',
                                                    },
                                                    body: JSON.stringify(
                                                        {
                                                            essay: paragraph,
                                                        }
                                                    )
                                                }
                                            )
                                        )
                                    );
                                    
                                    const summaries: string[] = [];

                                    for(const res of responses) {
                                        const json = await res.json();

                                        summaries.push(JSON.parse(json.substring(0, json.length - 3)).summary);
                                    }

                                    props.updateCards(
                                        summaries.map(
                                            (summary, index) => (
                                                {
                                                    title: `Summary for paragraph ${ index + 1 }`,
                                                    summary: summary
                                                }
                                            )
                                        )
                                    );
                                }, 1000);
                            });
                        } }
                    />

                    <HistoryPlugin />
                    <CommentPlugin focused={ props.focused } focusedIndex={ props.focusedIndex } />
                </div>
            </LexicalComposer>
        </>
    );
}
