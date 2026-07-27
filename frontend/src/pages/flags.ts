/**
 * Feature flags for in-progress pages.
 *
 * Deliberately tiny: a flag is a string, it is off unless switched on, and the
 * only thing it gates today is whether a page appears in the Labs menu. This is
 * not an experimentation system. If we ever need percentage rollout or per-user
 * targeting, that belongs on the session server-side — the `alwaysAllow` /
 * `isAllowed` pair in `backend/src/auth.ts` is the pattern to copy — not here,
 * because anything decided in this file is decided on the user's machine and can
 * be switched on by anyone who opens devtools. Flags here hide unfinished work
 * from a closed beta; they are not an access control.
 *
 * ## Turning one on
 *
 * Append `?ff=<flag>` to the URL (comma-separate several: `?ff=a,b`). The choice
 * is written to localStorage, so it survives the reloads the task pane does on
 * its own. `?ff=` with an empty value clears everything.
 *
 * ## Which surfaces the URL override actually reaches
 *
 * Only the standalone editor and the dev server. The Word task pane loads the URL
 * named in `manifest.xml`, and on Google Docs the bundle runs inside an Apps
 * Script sandbox iframe whose location is not addressable — on neither surface is
 * there a query string a user can edit.
 *
 * That is a deliberate consequence of the design rather than a gap to close: the
 * Labs menu, not the URL, is how a lab page is meant to be reached, and it works
 * identically on all three surfaces. Reach for a flag only when something must
 * stay out of even the Labs menu, and expect to demo it from the editor.
 */

const STORAGE_KEY = 'featureFlags';
const URL_PARAM = 'ff';

/**
 * localStorage is not reachable everywhere this bundle runs: a sandboxed iframe
 * without `allow-same-origin` throws on property access rather than returning
 * null, and Safari throws in private browsing. A flag lookup failing must never
 * take the navbar down with it, so every access is guarded and degrades to "no
 * flags set".
 */
function readStored(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? parseList(raw) : [];
	} catch {
		return [];
	}
}

function persist(flags: string[]): void {
	try {
		if (flags.length === 0) localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, flags.join(','));
	} catch {
		// Non-fatal: the flag still applies for this page load, just not the next.
	}
}

/** null when the parameter is absent — distinct from `?ff=`, which clears. */
function readUrl(): string[] | null {
	try {
		const raw = new URLSearchParams(window.location.search).get(URL_PARAM);
		return raw === null ? null : parseList(raw);
	} catch {
		return null;
	}
}

function parseList(raw: string): string[] {
	return raw
		.split(',')
		.map((flag) => flag.trim())
		.filter(Boolean);
}

// Resolved once per page load. The registry's `enabled` predicates run on every
// navbar render, and re-reading (and re-writing) storage each time would make
// rendering do I/O for a value that cannot change without a reload.
let cache: string[] | null = null;

/** The flags in effect for this page load. URL wins over storage, and updates it. */
export function enabledFlags(): string[] {
	if (cache) return cache;
	const fromUrl = readUrl();
	if (fromUrl !== null) persist(fromUrl);
	cache = fromUrl ?? readStored();
	return cache;
}

export function isFlagEnabled(flag: string): boolean {
	return enabledFlags().includes(flag);
}

/** Test seam — drops the per-load cache so a test can change the environment. */
export function resetFlagCache(): void {
	cache = null;
}
