/**
 * @format
 */
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import {
	type InitialEditorStateType,
	LexicalComposer,
} from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import {
	$getRoot,
	$getSelection,
	$isRangeSelection,
	type ElementNode,
	type LexicalNode,
} from 'lexical';

import classes from './editor.module.css';

function $getDocContext(): DocContext {
	// Initialize default empty context
	const docContext: DocContext = {
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	};

	// Get current selection
	const selection = $getSelection();

	// If no valid range selection exists, return empty context
	if (!$isRangeSelection(selection)) {
		return docContext;
	}

	// Get selected text content
	docContext.selectedText = selection.getTextContent();

	// Get points for traversal
	let anchor = selection.anchor;
	let focus = selection.focus;

	// If the selection is backward, we need to swap the anchor and focus points.
	if (selection.isBackward()) {
		const temp = anchor;
		anchor = focus;
		focus = temp;
	}

	const anchorNode = anchor.getNode();
	const focusNode = focus.getNode();
	const anchorOffset = anchor.offset;
	const focusOffset = focus.offset;

	// Collect text before cursor
	docContext.beforeCursor = getCursorText(anchorNode, anchorOffset, 'before');

	// Collect text after cursor
	docContext.afterCursor = getCursorText(focusNode, focusOffset, 'after');

	return docContext;
}

// DFS traversal to get document order
function collectNodes(
	node: ElementNode | LexicalNode,
	visitedNodes: Set<string>,
	allNodes: LexicalNode[],
) {
	const nodeKey = node.getKey();
	if (visitedNodes.has(nodeKey)) return;
	visitedNodes.add(nodeKey);

	allNodes.push(node);

	// Add children in document order
	if ('getChildren' in node) {
		const children = node.getChildren();
		for (const child of children) {
			// Recursively collect nodes
			collectNodes(child, visitedNodes, allNodes);
		}
	}
}

/**
 * Gets text from document start to cursor position or from cursor position to document end.
 */
function getCursorText(
	aNode: LexicalNode,
	aOffset: number,
	mode: string,
): string {
	let cursorText = '';

	const root = $getRoot();
	const visitedNodes = new Set<string>();

	// Get the text from the current node up to the cursor position
	const currentNodeText = aNode.getTextContent();

	let textInNode = '';

	if (mode === 'before') {
		textInNode = currentNodeText.substring(0, aOffset);
	} else if (mode === 'after') {
		textInNode = currentNodeText.substring(aOffset);
	}

	// First perform a traversal to build document order
	const allNodes: LexicalNode[] = [];
	const aKey = aNode.getKey();

	// DFS traversal to get document order
	collectNodes(root, visitedNodes, allNodes);
	visitedNodes.clear();

	// Flag to indicate we're past the focus node
	let pastFocusNode = false;

	for (const node of allNodes) {
		const nodeKey = node.getKey();
		// If we found the anchor node, add partial text and stop
		if (nodeKey === aKey) {
			cursorText += textInNode;
			if (mode === 'before') {
				break;
			} else if (mode === 'after') {
				pastFocusNode = true;
				continue;
			}
		}

		// For other nodes, add appropriate content based on node type
		// Only collect text for nodes after the focus
		if (pastFocusNode || mode === 'before') {
			if (node.getType() === 'text') {
				cursorText += node.getTextContent();
			} else if (node.getType() === 'paragraph') {
				cursorText += '\r';
			} else if (node.getType() === 'linebreak') {
				cursorText += '\u000b';
			}
		}
	}

	return cursorText;
}

function LexicalEditor({
	updateDocContext,
	initialState,
	storageKey = 'doc',
	preamble,
}: {
	updateDocContext: (docContext: DocContext) => void;
	initialState: InitialEditorStateType | null;
	storageKey?: string;
	preamble?: React.ReactNode;
}) {
	return (
		<LexicalComposer // Main editor component
			initialConfig={{
				namespace: 'essay',
				theme: {
					paragraph: classes.paragraph,
				},
				onError(_error, _editor) {},
				editorState: initialState,
			}}
		>
			<div className={classes.editorContainer}>
				<div className={classes.editor}>
					{preamble ? (
						<div className="whitespace-pre-line">{preamble}</div>
					) : null}
					<RichTextPlugin
						contentEditable={
							<ContentEditable className={classes.editor} />
						}
						placeholder={<div className={classes.placeholder} />}
						ErrorBoundary={LexicalErrorBoundary}
					/>

					<OnChangePlugin
						onChange={(editorState) => {
							editorState.read(() => {
								const docContext = $getDocContext();

								updateDocContext(docContext);

								localStorage.setItem(
									storageKey,
									JSON.stringify(editorState),
								);
								const currentDate = new Date().toISOString();
								localStorage.setItem(
									`${storageKey}-date`,
									currentDate,
								);
							});
						}}
					/>

					<AutoFocusPlugin />

					<HistoryPlugin />
				</div>
			</div>
		</LexicalComposer>
	);
}

export default LexicalEditor;
