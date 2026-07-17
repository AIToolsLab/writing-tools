/**
 * Persisted Better Auth token store.
 *
 * Keeps a bearer token across page refreshes so Better Auth can be the default auth
 * without forcing a fresh interactive login (device flow) or minting a brand-new
 * anonymous user (demo) on every reload.
 *
 * Two independent tokens, under two keys, deliberately kept apart:
 *   - the device-flow token (real signed-in session), and
 *   - the anonymous/demo token.
 * A demo token must never be picked up as a real session — the device-flow provider
 * hydrates only `betterauth.token`, so a stored demo token can't masquerade as a
 * signed-in user on a real-auth surface.
 *
 * Every localStorage access is guarded: Office task panes and other embedded browsers
 * can throw on storage access under some privacy/host settings. On failure we degrade to
 * in-memory-only for the session (load returns null; persist/clear become no-ops) so the
 * app keeps working.
 *
 * Security note: localStorage is XSS-exposed. This matches Auth0's prior
 * `cacheLocation="localstorage"` posture, so it does not raise the existing risk level.
 */
function makeTokenStore(key: string) {
	// Arrow functions (not methods) so callers can freely destructure/re-export them
	// without `this` binding concerns.
	const persist = (token: string): void => {
		try {
			localStorage.setItem(key, token);
		} catch {
			// Storage unavailable — fall back to in-memory for this session.
		}
	};
	const load = (): string | null => {
		try {
			return localStorage.getItem(key);
		} catch {
			return null;
		}
	};
	const clear = (): void => {
		try {
			localStorage.removeItem(key);
		} catch {
			// No-op if storage is unavailable.
		}
	};
	return { persist, load, clear };
}

const deviceStore = makeTokenStore('betterauth.token');
export const persistToken = deviceStore.persist;
export const loadToken = deviceStore.load;
export const clearToken = deviceStore.clear;

// Anonymous (demo) session token — a separate key so it can never be hydrated as a
// real signed-in session by the device-flow provider.
const demoStore = makeTokenStore('betterauth.demo-token');
export const persistDemoToken = demoStore.persist;
export const loadDemoToken = demoStore.load;
export const clearDemoToken = demoStore.clear;
