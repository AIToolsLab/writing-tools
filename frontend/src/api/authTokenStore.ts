/**
 * Persisted Better Auth token store.
 *
 * Keeps the device-flow access token across page refreshes so Better Auth can be the
 * default auth without forcing a fresh interactive login on every reload.
 *
 * Every localStorage access is guarded: Office task panes and other embedded browsers
 * can throw on storage access under some privacy/host settings. On failure we degrade to
 * in-memory-only for the session (load returns null; persist/clear become no-ops) so the
 * app keeps working.
 *
 * Security note: localStorage is XSS-exposed. This matches Auth0's prior
 * `cacheLocation="localstorage"` posture, so it does not raise the existing risk level.
 */
const TOKEN_KEY = 'betterauth.token';

export function persistToken(token: string): void {
	try {
		localStorage.setItem(TOKEN_KEY, token);
	} catch {
		// Storage unavailable — fall back to in-memory for this session.
	}
}

export function loadToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function clearToken(): void {
	try {
		localStorage.removeItem(TOKEN_KEY);
	} catch {
		// No-op if storage is unavailable.
	}
}
