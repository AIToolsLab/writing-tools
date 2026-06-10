/**
 * Resolves the backend base URL.
 *
 * Everywhere except the Google Docs sidebar a relative `/api` works (Word's dev
 * server and the production web host both serve the API under the same origin).
 *
 * The Google Docs sidebar is different: its HTML is served from a Google origin,
 * so a relative `/api` would hit Google's domain. The React bundle, however, is
 * loaded from the dev server (e.g. http://localhost:3001), which proxies `/api`
 * to the Python backend. We derive that origin from this script's own URL, so no
 * tunnel (ngrok) or hardcoded port is needed.
 */
function resolveServerUrl(): string {
	if (typeof window === 'undefined' || !window.RUNNING_IN_GOOGLE_DOCS) {
		return '/api';
	}
	const script = document.currentScript as HTMLScriptElement | null;
	if (script?.src) {
		return `${new URL(script.src).origin}/api`;
	}
	// Fallback to the dev server's default origin if currentScript is unavailable.
	return 'http://localhost:3001/api';
}

export const SERVER_URL = resolveServerUrl();

// Re-export editor APIs
export { wordEditorAPI } from './wordEditorAPI';
export {
	googleDocsEditorAPI,
	isRunningInGoogleDocs,
	getGoogleUserEmail,
} from './googleDocsEditorAPI';

/**
 * Detects the current platform and returns the appropriate EditorAPI.
 */
export function detectPlatform(): 'word' | 'google-docs' | 'standalone' {
	if (
		typeof window !== 'undefined' &&
		window.RUNNING_IN_GOOGLE_DOCS === true
	) {
		return 'google-docs';
	}
	if (typeof Office !== 'undefined') {
		return 'word';
	}
	return 'standalone';
}

// Define a type for payload. Includes at least: eventType and username
export interface LogPayload {
	username: string;
	event: string;
	// biome-ignore lint/suspicious/noExplicitAny: Logs should be able to hold anything serializable
	[key: string]: any;
}

export function log(payload: LogPayload) {
	const payloadWithTimestamp = {
		...payload,
		timestamp: Date.now() / 1000,
	};
	return fetch(`${SERVER_URL}/log`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(payloadWithTimestamp),
	});
}
