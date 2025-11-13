/**
 * @format
 * Inline autocomplete plugin for Lexical editor
 */
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
	$getSelection,
	$isRangeSelection,
	COMMAND_PRIORITY_HIGH,
	KEY_ARROW_RIGHT_COMMAND,
	KEY_ESCAPE_COMMAND,
	KEY_TAB_COMMAND,
	type LexicalEditor,
} from 'lexical';
import { useEffect, useRef, useState } from 'react';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:8000';
const DEBOUNCE_MS = 500; // Wait 500ms after typing stops

interface InlineAutocompletePluginProps {
	username?: string;
	enabled?: boolean;
}

function $getDocContext(): DocContext {
	const docContext: DocContext = {
		beforeCursor: '',
		selectedText: '',
		afterCursor: '',
	};

	const selection = $getSelection();
	if (!$isRangeSelection(selection)) {
		return docContext;
	}

	docContext.selectedText = selection.getTextContent();

	// Get simple text context (simplified version)
	const anchor = selection.anchor;
	const anchorNode = anchor.getNode();
	const textContent = anchorNode.getTextContent();
	const offset = anchor.offset;

	docContext.beforeCursor = textContent.substring(0, offset);
	docContext.afterCursor = textContent.substring(offset);

	return docContext;
}

function InlineAutocompletePlugin({
	username = '',
	enabled = true,
}: InlineAutocompletePluginProps) {
	const [editor] = useLexicalComposerContext();
	const [suggestion, setSuggestion] = useState<string>('');
	const [cursorPosition, setCursorPosition] = useState<{
		x: number;
		y: number;
	} | null>(null);
	const debounceTimer = useRef<NodeJS.Timeout | null>(null);
	const abortController = useRef<AbortController | null>(null);
	const [isLoading, setIsLoading] = useState(false);

	// Fetch autocomplete suggestion from backend
	const fetchSuggestion = async (docContext: DocContext) => {
		// Cancel any ongoing request
		if (abortController.current) {
			abortController.current.abort();
		}

		// Don't fetch if there's no text before cursor
		if (docContext.beforeCursor.trim().length < 3) {
			setSuggestion('');
			return;
		}

		abortController.current = new AbortController();
		setIsLoading(true);

		try {
			const response = await fetch(`${SERVER_URL}/api/get_suggestion`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					username: username,
					gtype: 'inline_autocomplete',
					doc_context: docContext,
				}),
				signal: abortController.current.signal,
			});

			if (!response.ok) {
				console.error('Failed to fetch suggestion:', response.statusText);
				setSuggestion('');
				return;
			}

			const data = await response.json();
			const suggestionText = data.result?.trim() || '';

			// Clean up the suggestion (remove quotes if present)
			const cleanedSuggestion = suggestionText.replace(/^["']|["']$/g, '');

			setSuggestion(cleanedSuggestion);
		} catch (error: any) {
			if (error.name !== 'AbortError') {
				console.error('Error fetching autocomplete:', error);
			}
			setSuggestion('');
		} finally {
			setIsLoading(false);
		}
	};

	// Get cursor position for overlay
	const updateCursorPosition = () => {
		const selection = window.getSelection();
		if (selection && selection.rangeCount > 0) {
			const range = selection.getRangeAt(0);
			const rect = range.getBoundingClientRect();
			setCursorPosition({
				x: rect.left,
				y: rect.top,
			});
		}
	};

	// Accept suggestion
	const acceptSuggestion = () => {
		if (!suggestion) return;

		editor.update(() => {
			const selection = $getSelection();
			if ($isRangeSelection(selection)) {
				selection.insertText(suggestion);
			}
		});

		setSuggestion('');
	};

	// Reject suggestion
	const rejectSuggestion = () => {
		setSuggestion('');
	};

	// Set up keyboard handlers
	useEffect(() => {
		if (!enabled) return;

		// Handle Tab key to accept
		const removeTabCommand = editor.registerCommand(
			KEY_TAB_COMMAND,
			(event: KeyboardEvent) => {
				if (suggestion) {
					event.preventDefault();
					acceptSuggestion();
					return true; // Handled
				}
				return false; // Not handled
			},
			COMMAND_PRIORITY_HIGH,
		);

		// Handle Right Arrow to accept
		const removeArrowCommand = editor.registerCommand(
			KEY_ARROW_RIGHT_COMMAND,
			(event: KeyboardEvent) => {
				if (suggestion) {
					event.preventDefault();
					acceptSuggestion();
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH,
		);

		// Handle Escape to reject
		const removeEscapeCommand = editor.registerCommand(
			KEY_ESCAPE_COMMAND,
			(event: KeyboardEvent) => {
				if (suggestion) {
					event.preventDefault();
					rejectSuggestion();
					return true;
				}
				return false;
			},
			COMMAND_PRIORITY_HIGH,
		);

		return () => {
			removeTabCommand();
			removeArrowCommand();
			removeEscapeCommand();
		};
	}, [editor, suggestion, enabled]);

	// Listen to editor changes and trigger autocomplete
	useEffect(() => {
		if (!enabled) return;

		const removeUpdateListener = editor.registerUpdateListener(
			({ editorState, dirtyElements, dirtyLeaves }) => {
				// Only trigger if there are actual changes
				if (dirtyElements.size === 0 && dirtyLeaves.size === 0) {
					return;
				}

				// Clear any existing suggestion when user types
				if (suggestion) {
					setSuggestion('');
				}

				// Clear existing timer
				if (debounceTimer.current) {
					clearTimeout(debounceTimer.current);
				}

				// Set new timer
				debounceTimer.current = setTimeout(() => {
					editorState.read(() => {
						const docContext = $getDocContext();
						updateCursorPosition();
						fetchSuggestion(docContext);
					});
				}, DEBOUNCE_MS);
			},
		);

		return () => {
			removeUpdateListener();
			if (debounceTimer.current) {
				clearTimeout(debounceTimer.current);
			}
			if (abortController.current) {
				abortController.current.abort();
			}
		};
	}, [editor, enabled, suggestion]);

	// Render ghost text overlay
	if (!suggestion || !cursorPosition) {
		return null;
	}

	return (
		<div
			style={{
				position: 'fixed',
				left: `${cursorPosition.x}px`,
				top: `${cursorPosition.y}px`,
				color: '#94a3b8', // Gray color for ghost text
				pointerEvents: 'none',
				whiteSpace: 'pre',
				fontFamily: 'inherit',
				fontSize: 'inherit',
				lineHeight: 'inherit',
				zIndex: 1000,
			}}
		>
			{suggestion}
		</div>
	);
}

export default InlineAutocompletePlugin;
