/**
 * Resolves the backend base URL.
 *
 * Whatever origin served this bundle also serves the backend API, so we
 * discover it at runtime instead of baking it in at build time — one built
 * image is deployed to both staging and production, and a compile-time
 * constant would send the staging sidebar to the production backend.
 *
 * The Google Docs sidebar is the case that needs the script tag: the page
 * itself is on a Google origin, but `sidebar.html` injects our bundle as a
 * classic <script> whose `src` points at the backend, and `currentScript` is
 * set while that script (and so this module) runs.
 *
 * When run as a Word task pane or in the standalone editor, the bundle
 * is a module script, where `document.currentScript` is null by spec. That's
 * the `window.location.origin` path; in development the dev server proxies
 * /api through to the backend, so localhost is the right origin there too.
 */
function resolveServerUrl(): string {
	if (typeof document === 'undefined') {
		// Not a browser (e.g. unit tests). Actual requests are mocked, so the URL doesn't matter.
		return '/api';
	}

	// Non-null only while a classic <script> executes (the Google Docs bundle).
	const script = document.currentScript as HTMLScriptElement | null;
	if (script?.src) {
		return `${new URL(script.src).origin}/api`;
	}
	// Module script: the page's own origin serves the API.
	return `${window.location.origin}/api`;
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

// Event logging moved to the consent-aware, authenticated `useLog` hook
// (@/hooks/useLog) — the server now derives identity from the session and
// requires a Bearer token, so logging must run inside the auth context.
