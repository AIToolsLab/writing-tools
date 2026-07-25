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

/** Append `wt_grant=<id>` to a URL's fragment without clobbering an existing hash. */
export function withGrantFragment(url: string, grantId: string): string {
	const u = new URL(url);
	const existing = u.hash.replace(/^#/, '');
	const param = `wt_grant=${encodeURIComponent(grantId)}`;
	u.hash = existing ? `${existing}&${param}` : param;
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
