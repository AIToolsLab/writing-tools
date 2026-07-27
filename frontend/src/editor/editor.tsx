/**
 * @format
 */
import { AutoFocusPlugin } from '@lexical/react/LexicalAutoFocusPlugin';
import {
	type InitialEditorStateType,
	LexicalComposer,
} from '@lexical/react/LexicalComposer';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import {
	$createParagraphNode,
	$createRangeSelection,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	$isTextNode,
	$setSelection,
	type ElementNode,
	type LexicalNode,
	type TextNode,
} from 'lexical';
import { useEffect } from 'react';

import classes from './editor.module.css';

/**
 * Imperative handle the "My Words" page uses to read and edit the standalone
 * Lexical document. Mirrors the host-agnostic operations on EditorAPI; Word and
 * Google Docs implement the same shape with their native APIs.
 */
export interface EditorControls {
	getText: () => string;
	/** Top-level paragraphs in order — the coordinate system for `view`. */
	getParagraphs: () => string[];
	/** Replace the whole document with plain text (paragraphs split on \n). */
	setText: (text: string) => void;
	/**
	 * Apply a paragraph-range splice by mutating only the affected paragraph
	 * nodes. Untouched nodes keep their keys, so the writer's cursor survives
	 * edits elsewhere and each splice is one undo entry — unlike `setText`,
	 * which rebuilds the whole document.
	 */
	applySplice: (splice: ParagraphSplice) => void;
	/** Select the first occurrence of `phrase` within a single paragraph. */
	selectPhrase: (phrase: string) => boolean;
}

/**
 * Set a paragraph's plain text in place. For the common single-text-node
 * paragraph, splices just the changed middle (common prefix/suffix preserved)
 * so the node key — and any cursor inside the untouched parts — survives.
 * Formatted/multi-node paragraphs fall back to rebuilding only this paragraph.
 */
export function $setParagraphText(node: ElementNode, text: string) {
	const kids = node.getChildren();
	if (kids.length === 1 && $isTextNode(kids[0])) {
		const textNode = kids[0];
		const old = textNode.getTextContent();
		if (old === text) return;
		if (text.length === 0) {
			textNode.remove();
			return;
		}
		let prefix = 0;
		const maxPrefix = Math.min(old.length, text.length);
		while (prefix < maxPrefix && old[prefix] === text[prefix]) prefix++;
		let suffix = 0;
		while (
			suffix < maxPrefix - prefix &&
			old[old.length - 1 - suffix] === text[text.length - 1 - suffix]
		)
			suffix++;
		textNode.spliceText(
			prefix,
			old.length - prefix - suffix,
			text.slice(prefix, text.length - suffix),
		);
		return;
	}
	node.clear();
	if (text.length > 0) node.append($createTextNode(text));
}

/**
 * Apply a paragraph-range splice by mutating only the affected paragraph
 * nodes. Must run inside `editor.update()`. Untouched nodes keep their keys,
 * so the writer's cursor survives edits elsewhere; one update per splice keeps
 * a split or merge a single undo entry.
 */
export function $applySplice(splice: ParagraphSplice) {
	const root = $getRoot();
	const children = root.getChildren();
	const { index, remove, insert } = splice;
	if (index < 0 || index + remove.length > children.length) {
		throw new Error(
			`Splice out of range: ${index}+${remove.length} of ${children.length} paragraph(s).`,
		);
	}
	// Overlapping positions: update text in place.
	const overlap = Math.min(remove.length, insert.length);
	for (let k = 0; k < overlap; k++) {
		const node = children[index + k];
		if ($isElementNode(node)) {
			$setParagraphText(node, insert[k]);
		} else {
			const paragraph = $createParagraphNode();
			if (insert[k].length > 0)
				paragraph.append($createTextNode(insert[k]));
			node.replace(paragraph);
		}
	}
	// Shrinkage: remove the leftover paragraphs (marks included).
	for (let k = overlap; k < remove.length; k++) {
		children[index + k].remove();
	}
	// Growth: append the extra paragraphs after the last touched one (or
	// anchor at the insertion point when nothing overlapped).
	let anchor: LexicalNode | null =
		overlap > 0
			? children[index + overlap - 1]
			: index > 0
				? (children[index - 1] ?? null)
				: null;
	for (let k = overlap; k < insert.length; k++) {
		const paragraph = $createParagraphNode();
		if (insert[k].length > 0) paragraph.append($createTextNode(insert[k]));
		if (anchor) anchor.insertAfter(paragraph);
		else if (children.length > 0) children[0].insertBefore(paragraph);
		else root.append(paragraph);
		anchor = paragraph;
	}
}

/**
 * Lives inside LexicalComposer so it can grab the editor instance and hand a
 * small imperative control surface back up to the EditorScreen.
 */
function ControlsPlugin({
	onReady,
}: {
	onReady?: (controls: EditorControls) => void;
}) {
	const [editor] = useLexicalComposerContext();

	useEffect(() => {
		if (!onReady) return;

		const controls: EditorControls = {
			getText: () =>
				editor.getEditorState().read(() => $getRoot().getTextContent()),

			getParagraphs: () =>
				editor.getEditorState().read(() =>
					$getRoot()
						.getChildren()
						.map((node) => node.getTextContent()),
				),

			setText: (text: string) => {
				editor.update(() => {
					const root = $getRoot();
					root.clear();
					for (const line of text.split('\n')) {
						const paragraph = $createParagraphNode();
						if (line.length > 0) {
							paragraph.append($createTextNode(line));
						}
						root.append(paragraph);
					}
				});
			},

			applySplice: (splice: ParagraphSplice) => {
				editor.update(() => $applySplice(splice));
			},

			selectPhrase: (phrase: string) => {
				let found = false;
				editor.update(() => {
					const textNodes: TextNode[] = [];
					const collect = (node: LexicalNode) => {
						if ($isTextNode(node)) {
							textNodes.push(node);
						} else if ('getChildren' in node) {
							for (const child of (
								node as ElementNode
							).getChildren()) {
								collect(child);
							}
						}
					};
					collect($getRoot());

					const needle = phrase.toLowerCase();
					for (const node of textNodes) {
						const idx = node
							.getTextContent()
							.toLowerCase()
							.indexOf(needle);
						if (idx === -1) continue;
						const selection = $createRangeSelection();
						selection.anchor.set(node.getKey(), idx, 'text');
						selection.focus.set(
							node.getKey(),
							idx + phrase.length,
							'text',
						);
						$setSelection(selection);
						found = true;
						return;
					}
				});
				return found;
			},
		};

		onReady(controls);
	}, [editor, onReady]);

	return null;
}

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
	onReady,
}: {
	updateDocContext: (docContext: DocContext) => void;
	initialState?: InitialEditorStateType | undefined;
	storageKey?: string;
	preamble?: React.JSX.Element;
	onReady?: (controls: EditorControls) => void;
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
				<div
					className={
						'resize-none text-base caret-zinc-900 relative outline-none overflow-y-auto h-full editor-scrollbar'
					}
				>
					{preamble ? (
						<div className="whitespace-pre-line">{preamble}</div>
					) : null}
					<RichTextPlugin
						contentEditable={
							<ContentEditable
								className={
									'resize-none text-base caret-zinc-900 relative outline-none'
								}
							/>
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

					<ControlsPlugin onReady={onReady} />
				</div>
			</div>
		</LexicalComposer>
	);
}

export default LexicalEditor;
