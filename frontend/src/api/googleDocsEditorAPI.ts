/**
 * Google Docs Editor API
 *
 * This module provides an EditorAPI implementation for Google Docs,
 * bridging the React frontend with Google Apps Script via google.script.run.
 *
 * Unlike the Word add-in which uses Office.js directly in the browser,
 * all document operations here go through Apps Script on Google's servers.
 */

import { loadScratchpadLocal, saveScratchpadLocal } from './scratchpadStore';

// Declare the global GoogleAppsScript bridge (defined in sidebar.html)
declare global {
	interface Window {
		GoogleAppsScript: {
			run: (functionName: string, ...args: unknown[]) => Promise<unknown>;
			getDocContext: () => Promise<DocContext>;
			selectPhrase: (phrase: string) => Promise<boolean>;
			insertTextAtCursor: (text: string) => Promise<boolean>;
			replaceSelection: (newText: string) => Promise<boolean>;
			sendChatMessage: (
				messages: ChatMessage[],
				docContext: DocContext,
				username: string,
			) => Promise<unknown>;
			analyzeText: (
				docContext: DocContext,
				username: string,
				options: Record<string, unknown>,
			) => Promise<unknown>;
			logEvent: (payload: Record<string, unknown>) => Promise<void>;
			getCurrentUserEmail: () => Promise<string>;
			setUserProperty: (key: string, value: string) => Promise<void>;
			getUserProperty: (key: string) => Promise<string | null>;
			getDocumentId: () => Promise<string>;
			getAllTabs: () => Promise<{ id: string; title: string; text: string }[]>;
			selectInTab: (
				tabId: string,
				phrase: string,
				occurrenceIndex?: number,
			) => Promise<boolean>;
		};
		RUNNING_IN_GOOGLE_DOCS?: boolean;
	}
}

/**
 * Selection change handlers.
 * Note: Google Docs doesn't have real-time selection change events like Word.
 * We implement polling as a workaround.
 */
const selectionChangeHandlers: Set<() => void> = new Set();
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let lastDocContext: DocContext | null = null;

/**
 * Starts polling for selection changes.
 * This is a workaround since Google Docs doesn't provide selection change events.
 */
function startPolling() {
	if (pollingInterval) return;

	const pollForChanges = async () => {
		if (selectionChangeHandlers.size === 0) {
			stopPolling();
			return;
		}

		try {
			const newContext = await window.GoogleAppsScript.getDocContext();

			// Check if selection changed
			if (
				!lastDocContext ||
				lastDocContext.selectedText !== newContext.selectedText ||
				lastDocContext.beforeCursor !== newContext.beforeCursor
			) {
				lastDocContext = newContext;
				// Notify all handlers
				for (const handler of selectionChangeHandlers) {
					try {
						handler();
					} catch (e) {
						console.error('Selection change handler error:', e);
					}
				}
			}
		} catch (e) {
			console.error('Error polling for selection changes:', e);
		}
	};

	pollingInterval = setInterval(() => {
		void pollForChanges();
	}, 1000); // Poll every second
}

/**
 * Stops polling for selection changes.
 */
function stopPolling() {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
	}
}

/**
 * Google Docs implementation of the EditorAPI interface.
 */
export const googleDocsEditorAPI: EditorAPI = {
	/**
	 * Adds a handler for selection changes.
	 * Uses polling since Google Docs doesn't provide native selection events.
	 */
	addSelectionChangeHandler: (handler: () => void) => {
		selectionChangeHandlers.add(handler);
		startPolling();
	},

	/**
	 * Removes a selection change handler.
	 */
	removeSelectionChangeHandler: (handler: () => void) => {
		selectionChangeHandlers.delete(handler);
		if (selectionChangeHandlers.size === 0) {
			stopPolling();
		}
	},

	/**
	 * Gets the current document context (before cursor, selection, after cursor).
	 */
	async getDocContext(): Promise<DocContext> {
		const context = await window.GoogleAppsScript.getDocContext();

		// Normalize line endings (Google Docs uses \n)
		return {
			beforeCursor: context.beforeCursor || '',
			selectedText: context.selectedText || '',
			afterCursor: context.afterCursor || '',
		};
	},

	/**
	 * Selects a phrase in the document.
	 */
	async selectPhrase(phrase: string): Promise<void> {
		const found = await window.GoogleAppsScript.selectPhrase(phrase);
		if (!found) {
			throw new Error('Phrase not found');
		}
	},

	/** Full document text, used for the corpus and the `view` tool. */
	async getDocText(): Promise<string> {
		const ctx = await window.GoogleAppsScript.getDocContext();
		return `${ctx.beforeCursor || ''}${ctx.selectedText || ''}${ctx.afterCursor || ''}`;
	},

	/** Paragraphs in order — the coordinate system for `view` and inserts. */
	async getParagraphs(): Promise<string[]> {
		const ctx = await window.GoogleAppsScript.getDocContext();
		const text = `${ctx.beforeCursor || ''}${ctx.selectedText || ''}${ctx.afterCursor || ''}`;
		return text.split('\n');
	},

	// TODO(my-words): bridge to Apps Script (selectPhrase + replaceSelection for
	// str_replace; insertTextAtCursor for insert). The GDocs multi-tab corpus
	// (getAllTabs) is the exciting follow-up. Deferred — v1 targets standalone.
	applyEdit(_edit: DocEdit): Promise<void> {
		return Promise.reject(
			new Error('applyEdit is not implemented for Google Docs yet'),
		);
	},
	loadScratchpad(): Promise<string> {
		return loadScratchpadLocal();
	},
	saveScratchpad(text: string): Promise<void> {
		return saveScratchpadLocal(text);
	},
};

/**
 * Helper function to check if we're running in Google Docs.
 */
export function isRunningInGoogleDocs(): boolean {
	return (
		typeof window !== 'undefined' &&
		window.RUNNING_IN_GOOGLE_DOCS === true &&
		typeof window.GoogleAppsScript !== 'undefined'
	);
}

/**
 * Gets the current user's email from Google.
 * Used as the identifier for the Google Docs surface (which runs in demo mode).
 */
export async function getGoogleUserEmail(): Promise<string | null> {
	if (!isRunningInGoogleDocs()) {
		return null;
	}

	try {
		return await window.GoogleAppsScript.getCurrentUserEmail();
	} catch (e) {
		console.error('Error getting Google user email:', e);
		return null;
	}
}
