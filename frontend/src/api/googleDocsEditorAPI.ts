/**
 * Google Docs Editor API
 *
 * This module provides an EditorAPI implementation for Google Docs,
 * bridging the React frontend with Google Apps Script via google.script.run.
 *
 * Unlike the Word add-in which uses Office.js directly in the browser,
 * all document operations here go through Apps Script on Google's servers.
 */

import {
	type DocumentSettingsAPI,
	localStorageDocumentSettings,
} from './documentSettings';

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
			// Document properties are optional on the type because the bundle is
			// loaded into an Apps Script deployment we don't version together with
			// it — an older sidebar.html simply won't have them. See
			// `documentPropertyBridge` below.
			setDocumentProperty?: (key: string, value: string) => Promise<void>;
			getDocumentProperty?: (key: string) => Promise<string | null>;
			getDocumentId: () => Promise<string>;
			getAllTabs: () => Promise<
				{ id: string; title: string; text: string }[]
			>;
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
 *
 * Google Docs has no real-time selection-change event like Word, and the only
 * way to observe a change is to re-fetch the entire document through Apps
 * Script (a slow, quota-metered round-trip). So most of the app is pull-based
 * (it calls `getDocContext()` on demand) and does not register here at all.
 *
 * A handler is registered only by the rare feature that genuinely needs to
 * react to the user's selection as they move it (e.g. the tag linker). For
 * those, we poll — but only while the sidebar is actually in front of the user
 * (visible and focused). When the user is editing the document (sidebar
 * blurred) or the tab is hidden, polling pauses, so we never re-fetch the whole
 * document in the background.
 */
const selectionChangeHandlers: Set<() => void> = new Set();
let pollingInterval: ReturnType<typeof setInterval> | null = null;
let lastDocContext: DocContext | null = null;
let lifecycleListenersAttached = false;

const POLL_INTERVAL_MS = 1000;

/**
 * Whether the sidebar is currently in front of the user. We only poll while
 * this is true — polling while the user is elsewhere just burns Apps Script
 * quota re-fetching a document they're not looking at through the sidebar.
 */
function sidebarIsActive(): boolean {
	if (typeof document === 'undefined') return false;
	if (document.visibilityState !== 'visible') return false;
	// hasFocus() may be undefined in some embedded contexts; treat that as active.
	return typeof document.hasFocus !== 'function' || document.hasFocus();
}

/**
 * Fetches the current context and, if the selection/cursor changed since the
 * last fetch, notifies every registered handler.
 */
async function pollForChanges(): Promise<void> {
	if (selectionChangeHandlers.size === 0) {
		stopPolling();
		return;
	}

	try {
		const newContext = await window.GoogleAppsScript.getDocContext();

		if (
			!lastDocContext ||
			lastDocContext.selectedText !== newContext.selectedText ||
			lastDocContext.beforeCursor !== newContext.beforeCursor
		) {
			lastDocContext = newContext;
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
}

/**
 * Starts the polling interval, if it isn't already running and the sidebar is
 * active. Does nothing while the sidebar is in the background.
 */
function runInterval(): void {
	if (pollingInterval || selectionChangeHandlers.size === 0) return;
	if (!sidebarIsActive()) return;

	pollingInterval = setInterval(() => {
		void pollForChanges();
	}, POLL_INTERVAL_MS);
}

/**
 * Stops the polling interval without tearing down the handler registration or
 * lifecycle listeners, so polling can resume when the sidebar becomes active.
 */
function pauseInterval(): void {
	if (pollingInterval) {
		clearInterval(pollingInterval);
		pollingInterval = null;
	}
}

/**
 * Resumes or pauses polling in response to focus/visibility changes.
 */
function handleLifecycleChange(): void {
	if (selectionChangeHandlers.size === 0) return;

	if (sidebarIsActive()) {
		// The user just came back to the sidebar — refresh immediately so a
		// selection they made while away is picked up without waiting a tick.
		void pollForChanges();
		runInterval();
	} else {
		pauseInterval();
	}
}

function attachLifecycleListeners(): void {
	if (lifecycleListenersAttached || typeof window === 'undefined') return;
	window.addEventListener('focus', handleLifecycleChange);
	window.addEventListener('blur', handleLifecycleChange);
	document.addEventListener('visibilitychange', handleLifecycleChange);
	lifecycleListenersAttached = true;
}

function detachLifecycleListeners(): void {
	if (!lifecycleListenersAttached || typeof window === 'undefined') return;
	window.removeEventListener('focus', handleLifecycleChange);
	window.removeEventListener('blur', handleLifecycleChange);
	document.removeEventListener('visibilitychange', handleLifecycleChange);
	lifecycleListenersAttached = false;
}

/**
 * Begins reacting to selection changes for the newly-registered handler:
 * pull once immediately, then poll only while the sidebar is active.
 */
function startPolling(): void {
	attachLifecycleListeners();
	// Pull once right away so a freshly-registered listener gets current state,
	// but only if the sidebar is in front of the user — otherwise the first pull
	// waits until they return (handled by the focus/visibility listener).
	if (sidebarIsActive()) {
		void pollForChanges();
	}
	runInterval();
}

/**
 * Stops polling entirely and removes lifecycle listeners. Called once the last
 * handler is removed.
 */
function stopPolling(): void {
	pauseInterval();
	detachLifecycleListeners();
	lastDocContext = null;
}

/**
 * Document-scoped settings, backed by Apps Script document properties.
 *
 * The React bundle is loaded from our own host into whatever Apps Script
 * deployment the user installed, so the two versions can drift: a sidebar
 * deployed before document properties existed has no bridge for them. Rather
 * than throw (or silently drop what the writer typed), fall back to
 * localStorage — the value stops travelling with the document, but it still
 * comes back for this writer, and re-deploying the add-on restores the real
 * behavior.
 */
const localDocumentSettingsFallback =
	localStorageDocumentSettings('google-docs');

let warnedAboutMissingBridge = false;

function documentPropertyBridge(): DocumentSettingsAPI | null {
	const bridge = window.GoogleAppsScript;
	if (
		typeof bridge?.getDocumentProperty !== 'function' ||
		typeof bridge.setDocumentProperty !== 'function'
	) {
		if (!warnedAboutMissingBridge) {
			warnedAboutMissingBridge = true;
			console.warn(
				'This Google Docs add-on deployment has no document-property bridge; ' +
					'document settings will be kept in this browser only. Re-deploy the ' +
					'add-on to store them with the document.',
			);
		}
		return null;
	}
	const { getDocumentProperty, setDocumentProperty } = bridge;
	return {
		getDocumentSetting: (key) => getDocumentProperty(key),
		setDocumentSetting: (key, value) => setDocumentProperty(key, value),
	};
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
	 * Reads a setting stored on the document (see {@link documentPropertyBridge}).
	 */
	async getDocumentSetting(key: string): Promise<string | null> {
		const settings =
			documentPropertyBridge() ?? localDocumentSettingsFallback;
		try {
			return (await settings.getDocumentSetting(key)) ?? null;
		} catch (error) {
			console.warn(`Could not read document setting "${key}":`, error);
			return null;
		}
	},

	/**
	 * Writes a setting onto the document, where everyone who opens it sees it.
	 */
	async setDocumentSetting(key: string, value: string): Promise<void> {
		const settings =
			documentPropertyBridge() ?? localDocumentSettingsFallback;
		await settings.setDocumentSetting(key, value);
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
