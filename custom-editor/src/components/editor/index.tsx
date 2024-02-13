import { ReactNode, createContext, useState } from 'react';

// #region Lexical Imports
import {
    $getRoot,
    $getSelection,
    $createTextNode,
    $isRangeSelection,
    $createRangeSelection,
    DecoratorNode,
    ElementNode,
    TextNode,
    NodeKey,
    LexicalNode,
    $applyNodeReplacement,
    LexicalEditor,
    SerializedElementNode,
    SerializedLexicalNode
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

export const SelectedQuestionContext = createContext<{ selectedQuestion: string | null; setSelectedQuestion: (_: string | null) => void; }>({
  selectedQuestion: null,
  setSelectedQuestion: () => {},
});

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

export class IdeaNode extends DecoratorNode<ReactNode> {
    static contextType = SelectedQuestionContext;
    // __id: string;
  
    static getType(): string {
      return 'idea';
    }
  
    static clone(node: IdeaNode): IdeaNode {
      return new IdeaNode(node.__key);
    }
  
    constructor(id?: string, key?: NodeKey) {
      super(key);
    //   this.__id = id;
    }
  
    static importJSON(serializedNode: any): IdeaNode {
        const node = $createIdeaNode();
        return node;
    }

    exportJSON() {
        return {
            type: 'idea',
            version: 1,
        };
    }

    createDOM(): HTMLElement {
        console.log('IdeaNode.createDOM');
      return document.createElement('span');
    }
  
    updateDOM(): false {
      return false;
    }
  
    decorate(): ReactNode {
      const handleClick = () => {
        const { setSelectedQuestion } = this.context;
        if (setSelectedQuestion) {
          setSelectedQuestion('Will this work?');
        }
      };

      return (
        <span 
          style={ { color: 'grey', cursor: 'pointer' } }
          onClick={ handleClick }
        >
          because...
        </span>
      );
    }
}

  IdeaNode.contextType = SelectedQuestionContext;

  export function $createIdeaNode(): IdeaNode {
    // TODO: https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/nodes/EquationNode.tsx#L57 has $applyNodeReplacement but I don't know why
    return new IdeaNode();
  }
  
  export function $isIdeaNode(
    node: LexicalNode | null | undefined,
  ): node is IdeaNode {
    return node instanceof IdeaNode;
  }

  export class HighlightElementNode extends ElementNode {
  
    static getType() {
      return 'highlightElement';
    }
  
    static clone(node: HighlightElementNode) {
      return new HighlightElementNode(node.__key);
    }
  
    constructor(key?: NodeKey) {
      super(key);
    }

    static importJSON(serializedNode: any): HighlightElementNode {
      const node = new HighlightElementNode();
      return node;
    }
  
    exportJSON(): SerializedElementNode<SerializedLexicalNode> {
      return {
        type: 'highlightElement',
        version: 1,
        children: this.children.map((child: { exportJSON: () => any; }) => child.exportJSON()),
        direction: this.direction,
        format: this.format,
        indent: this.indent,
      };
    }
  
    createDOM() {
      const element = document.createElement('span');
      element.style.backgroundColor = 'yellow'; // Highlight color
      return element;
  }
  
    updateDOM() {
      return false;
    }
  }

  export function HighlightPlugin() {
    const [editor] = useLexicalComposerContext();
  
    const insertHighlight = () => {
      editor.update(() => {
        const selection = $getSelection();
        if ($isRangeSelection(selection) && !selection.isCollapsed()) {
          // Extract the selected text from the document
          const selectedText = selection.getTextContent();
          
          // Clear the selected text
          selection.removeText();
    
          // Create a new HighlightElementNode and TextNode
          const highlightNode = new HighlightElementNode();
          const textNode = $createTextNode(selectedText);
          
          // Append the textNode to the highlightNode
          highlightNode.append(textNode);
    
          // Insert the highlightNode at the selection
          selection.insertNodes([highlightNode]);
        }
      });
    };
    

    // Return a UI element, like a button, to trigger the highlight functionality
    return (
        <button onClick={ insertHighlight } className={ classes.highlightButton }>
            Highlight Text
        </button>
    );
}

function highlightWordsWithE(editor: LexicalEditor) {
  console.log('highlightWordsWithE called'); // Log when function is called
  editor.update(() => {
    const root = $getRoot();
    const textNodes = root.getDescendants(TextNode);
    console.log('Total text nodes:', textNodes.length); // Log total number of text nodes

    textNodes.forEach((node: { getTextContent: () => any; }) => {
      if (node instanceof TextNode) {
        const textContent = node.getTextContent();
        console.log('Text Node Content:', textContent); // Log each text node's content
        if (textContent.includes('e')) {
          console.log('Found \'e\' in:', textContent); // Log nodes with 'e'
          // Highlighting logic goes here
        }
      }
    });
  });
}



function HighlightEPlugin() {
  const [editor] = useLexicalComposerContext();

  const handleHighlightClick = () => {
    console.log('Highlight button clicked'); // Add this for testing
    highlightWordsWithE(editor);
  };

  return (
    <button onClick={ handleHighlightClick } className={ classes.highlightButton }>
      Highlight 'e'
    </button>
  );
}

const initialEditorState = {
      'root': {
          'type': 'root',
          'direction': 'ltr',
          'format': '',
          'indent': 0,
          'version': 1,
          'children': [
            {
                'type': 'paragraph',
                'direction': 'ltr',
                'format': '',
                'indent': 0,
                'version': 1,
                'children': [
                  {
                    'type': 'text',
                    'text': 'Hi',
                    'detail': 0,
                    'format': 0,
                    'mode': 'normal',
                    'style': '',
                    'version': 1
                  },
                  {
                    'type': 'idea',
                  }
                ],
            },
            {
                'type': 'paragraph',
                'children': [
                    {
                        'type': 'idea',
                    }
                ],
            },
            {
                'type': 'paragraph',
                'direction': 'ltr',
                'format': '',
                'indent': 0,
                'version': 1,
                'children': [
                    {
                        'type': 'highlight',
                        'children': [
                            {
                                'type': 'text',
                                'text': 'HIGHLIGHTED TEXT WOO HOO!',
                                'detail': 0,
                                'format': 0,
                                'mode': 'normal',
                                'style': '',
                                'version': 1
                            }
                        ]
                    }
                ],
            },
          ],
      }
    };
  

export default function Editor(props: EditorProps) {
    // Store previous text state to compare with current state
    const [textState, updateTextState] = useState(''); 
    const [previousComment, updatePreviousComment] = useState(-1);
    const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);

    return (
      <SelectedQuestionContext.Provider value={ { selectedQuestion, setSelectedQuestion } }>
            <LexicalComposer // Main editor component
                initialConfig={
                    {
                        namespace: 'essay',
                        theme: {
                            paragraph: classes.paragraph,
                        },
                        nodes: [IdeaNode, HighlightElementNode],
                        onError(_error, _editor) {},
                        editorState: JSON.stringify(initialEditorState)
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
                    <HighlightEPlugin />
                    <HighlightPlugin />
                </div>
                <div className="sidebar">
                  { selectedQuestion ? (
                    <div>
                      <h2>Question</h2>
                      <p>{ selectedQuestion }</p>
                    </div>
                  ) : (
                    <p>Select a node to view the question.</p>
                  ) }
                </div>
            </LexicalComposer>
            </SelectedQuestionContext.Provider>
    );
}
