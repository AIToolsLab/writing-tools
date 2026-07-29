/**
 * Tool launcher — client side of the handoff grant flow (see
 * docs/tool-launcher-plan.md, Phase 1; backend/src/toolGrants.ts).
 *
 * The taskpane is the only surface that can read the Office document and holds a
 * signed-in session, so it mints the launch grant on the tool's behalf: it posts
 * the chosen tool + scopes (and an optional document snapshot) to /api/handoff, gets
 * back a single-use grant_id, and opens the tool at `…#wt_grant=<grant_id>`. The
 * grant travels in the URL *fragment*, which browsers never send to the server or
 * write to intermediary access logs, so the credential doesn't leak in transit.
 */
import { SERVER_URL } from './index';

export type ToolScope = 'openai:chat' | 'log:write' | 'doc:read' | 'doc:write';

export interface HandoffRequest {
	/** A tool client_id registered in the backend device allowlist. */
	toolClientId: string;
	/**
	 * The URL this launch will open. The backend reduces it to an origin and binds the
	 * grant to it, then refuses any exchange whose `Origin` doesn't match — so a grant
	 * that leaks can't be redeemed by a page other than the tool being launched.
	 */
	toolUrl: string;
	/** Scopes to grant; the backend defaults a read-only set when omitted. */
	scopes?: ToolScope[];
	/** Read-only document snapshot to hand the tool, or omit to share none. */
	doc?: DocContext;
}

/**
 * Create a launch grant. `token` is the current session bearer (from
 * `useAppAuth().getAccessToken()`); the request is credential-omitting and
 * bearer-only, matching the rest of the authenticated client surface.
 */
export async function createHandoff(
	token: string,
	req: HandoffRequest,
): Promise<{ grantId: string; expiresIn: number }> {
	const res = await fetch(`${SERVER_URL}/handoff`, {
		method: 'POST',
		credentials: 'omit',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			tool_client_id: req.toolClientId,
			tool_url: req.toolUrl,
			scopes: req.scopes,
			doc: req.doc,
		}),
	});
	if (!res.ok) {
		const detail = await res
			.json()
			.then((b: { detail?: string }) => b.detail)
			.catch(() => undefined);
		throw new Error(detail ?? `Handoff failed (${res.status})`);
	}
	const body = (await res.json()) as { grant_id: string; expires_in: number };
	return { grantId: body.grant_id, expiresIn: body.expires_in };
}

/**
 * Our API base as an absolute URL, for handing to a tool on another origin. `SERVER_URL`
 * is relative (`/api`) everywhere but the Google Docs sidebar, which is fine for our own
 * pages and useless to a tool in a different tab.
 */
export function platformApiBase(): string {
	// No window (tests, SSR-ish contexts): nothing to resolve a relative base against,
	// so hand back what we have rather than throwing mid-launch.
	if (typeof window === 'undefined') return SERVER_URL;
	return new URL(SERVER_URL, window.location.origin).toString().replace(/\/+$/, '');
}

/**
 * Append the launch parameters to a URL's fragment without clobbering an existing hash.
 *
 * A fragment (not a query) because browsers never send it to the tool's server or write
 * it to intermediary access logs, so the grant doesn't leak in transit.
 *
 * `wt_api` names the platform that issued the grant, so the tool talks to the backend
 * that granted it instead of one baked in at build time. That is what lets a single
 * hosted bundle serve prod, staging and a developer's localhost — and it is the honest
 * arrangement regardless, since a grant is only ever redeemable at its issuer.
 */
export function withGrantFragment(
	url: string,
	grantId: string,
	apiBase: string = platformApiBase(),
): string {
	const u = new URL(url);
	const existing = u.hash.replace(/^#/, '');
	const params = [
		`wt_grant=${encodeURIComponent(grantId)}`,
		`wt_api=${encodeURIComponent(apiBase)}`,
	].join('&');
	u.hash = existing ? `${existing}&${params}` : params;
	return u.toString();
}

/**
 * Open a URL in the user's real browser. In the Word task pane
 * `Office.context.ui.openBrowserWindow` hands off to the system browser (a full-page
 * tool needs a full page); everywhere else a normal new tab. `noopener` severs the
 * `window.opener` back-reference so the tool can't script the launching context.
 */
export function openInBrowser(url: string): void {
	const officeUi = (
		globalThis as {
			Office?: {
				context?: { ui?: { openBrowserWindow?: (u: string) => void } };
			};
		}
	).Office?.context?.ui;
	if (officeUi?.openBrowserWindow) {
		officeUi.openBrowserWindow(url);
		return;
	}
	window.open(url, '_blank', 'noopener,noreferrer');
}

export type BrowserLaunchReservation =
	| { kind: 'office' }
	| { kind: 'window'; popup: Window };

function officeBrowserOpener(): ((url: string) => void) | undefined {
	const officeUi = (
		globalThis as {
			Office?: {
				context?: { ui?: { openBrowserWindow?: (u: string) => void } };
			};
		}
	).Office?.context?.ui;
	return officeUi?.openBrowserWindow?.bind(officeUi);
}

/**
 * Reserve a browser popup before any asynchronous work or document access.
 * Office's system-browser API does not use popup blocking, so it remains deferred
 * until the final URL is ready.
 *
 * ## Why not a plain `<a href>`
 *
 * A link is the better answer wherever it fits, and it is worth re-checking this
 * if the launch flow ever changes shape. It does not fit here, for three reasons
 * that compound:
 *
 * 1. **The URL does not exist yet at click time.** It carries a single-use grant
 *    id minted by the backend, so producing it means an async round trip — plus
 *    reading the document first. There is no href to put on the anchor until
 *    that finishes.
 * 2. **Reserving synchronously is the popup check.** `window.open` only inherits
 *    the user's activation on the click itself; called after an `await` it is
 *    blocked. Doing it first is what lets a blocked popup abort the launch
 *    *before* the document is read and transmitted — the failure surfaces while
 *    nothing has left the machine yet. Deferring the open inverts that: the doc
 *    goes out, then the window is refused, and the writer sees nothing happen.
 * 3. **Pre-minting to fill an href burns the TTL.** Grants expire ~2 minutes
 *    after issue (`backend/src/db.ts`), and a link minted on render starts that
 *    clock before the writer has decided to click.
 *
 * The cost is a blank `about:blank` tab during the round trip, which
 * `cancelBrowserLaunch` closes if the launch fails.
 */
export function reserveBrowserLaunch(): BrowserLaunchReservation | null {
	if (officeBrowserOpener()) return { kind: 'office' };
	const popup = window.open('about:blank', '_blank');
	if (!popup) return null;
	try {
		popup.opener = null;
	} catch {
		// Some browser wrappers expose a read-only opener.
	}
	return { kind: 'window', popup };
}

export function completeBrowserLaunch(
	reservation: BrowserLaunchReservation,
	url: string,
): void {
	if (reservation.kind === 'office') {
		officeBrowserOpener()?.(url);
		return;
	}
	reservation.popup.location.replace(url);
}

export function cancelBrowserLaunch(reservation: BrowserLaunchReservation): void {
	if (reservation.kind === 'window' && !reservation.popup.closed) {
		reservation.popup.close();
	}
}
