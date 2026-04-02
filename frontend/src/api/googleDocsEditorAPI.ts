/**
 * Google Docs Editor API
 *
 * This module provides an EditorAPI implementation for Google Docs,
 * bridging the React frontend with Google Apps Script via google.script.run.
 *
 * Unlike the Word add-in which uses Office.js directly in the browser,
 * all document operations here go through Apps Script on Google's servers.
 */

import type { Auth0ContextInterface } from '@auth0/auth0-react';

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
	 * Handles login for Google Docs.
	 * Since users are already authenticated with Google, we use their Google identity.
	 * For Auth0 integration, we could implement a popup flow similar to Word.
	 */
	async doLogin(auth0Client: Auth0ContextInterface): Promise<void> {
		// Option 1: Use Google identity directly (simpler)
		// The user is already logged into Google, so we can use their email
		// as the identifier and skip Auth0 entirely for Google Docs.

		// Option 2: Implement Auth0 popup flow (for consistency with Word)
		// This would require opening a popup window and handling the OAuth flow.

		// For now, we'll use a simplified approach that works with Google identity
		console.log(
			'Google Docs login: Using Google identity. Auth0 integration pending.',
		);

		// If Auth0 is required, we could implement a similar popup flow:
		// 1. Open a popup to Auth0 login URL
		// 2. Have the popup redirect back with tokens
		// 3. Store tokens via Apps Script user properties

		// Placeholder: trigger Auth0 login if needed
		try {
			await auth0Client.loginWithRedirect({
				openUrl: (url: string) => {
					// Open in a new window since we can't do redirects in an iframe
					const popup = window.open(
						url,
						'auth0-login',
						'width=500,height=600',
					);

					// Poll for completion (the popup should post a message when done)
					const pollTimer = setInterval(() => {
						if (popup?.closed) {
							clearInterval(pollTimer);
							// Check if we're now logged in
							auth0Client.getAccessTokenSilently().catch(() => {
								console.log('Auth0 login was cancelled or failed');
							});
						}
					}, 500);
				},
			});
		} catch (error) {
			console.error('Auth0 login error:', error);
		}
	},

	/**
	 * Handles logout for Google Docs.
	 */
	async doLogout(auth0Client: Auth0ContextInterface): Promise<void> {
		try {
			await auth0Client.logout({
				openUrl: (url: string) => {
					// Open logout URL in a popup
					const popup = window.open(
						url,
						'auth0-logout',
						'width=500,height=400',
					);

					// Close popup after a brief delay
					setTimeout(() => {
						popup?.close();
					}, 2000);
				},
				logoutParams: {
					returnTo: window.location.origin,
				},
			});
		} catch (error) {
			console.error('Auth0 logout error:', error);
		}
	},

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
 * This can be used as a fallback identifier if Auth0 is not configured.
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
