/**
 * Resolves the backend base URL.
 *
 * Everywhere except the Google Docs sidebar a relative `/api` works (Word's dev
 * server and the production web host both serve the API under the same origin).
 *
 * The Google Docs sidebar is different: its HTML is served from a Google origin,
 * so a relative `/api` would hit Google's domain instead of the backend:
 *
 * - Production: the bundle is loaded from an external URL (see the Apps Script sidebar). If
 *   `GDOCS_BACKEND_URL` is provided at build time, use it; otherwise derive the backend origin
 *   from the bundle script's own URL.
 * - Development: the bundle is loaded from the dev server (e.g. localhost:3001), which proxies
 *   `/api` to the Python backend. We derive that origin from this script's own URL, so no
 *   tunnel (ngrok) or hardcoded port is needed.
 */
function resolveServerUrl(): string {
	if (typeof window === 'undefined' || !window.RUNNING_IN_GOOGLE_DOCS) {
		return '/api';
	}
	// Production: deployed backend origin injected at build time (see the Google
	// Docs webpack config's DefinePlugin). Empty string in dev builds.
	const deployed = process.env.GDOCS_BACKEND_URL;
	if (deployed) {
		return `${deployed}/api`;
	}
	// Development: the bundle's own origin is the dev server, which proxies /api.
	const script = document.currentScript as HTMLScriptElement | null;
	if (script?.src) {
		return `${new URL(script.src).origin}/api`;
	}
	// No script src to read (e.g. inlined bundle): fall back to a relative /api.
	return '/api';
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
