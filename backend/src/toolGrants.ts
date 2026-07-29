/**
 * Launch grants for the tool launcher (see docs/tool-launcher-plan.md, Phase 1).
 *
 * A "tool" is an external writing prototype launched from the sidebar — it runs on
 * its own foreign origin (researcher-hosted), never touches Office.js, and never
 * sees our cookies. To give it access "under the user's account" without an
 * interactive login, the taskpane (already signed in) mints a **launch grant**:
 *
 *   1. taskpane → POST /api/handoff (authenticated): stash { user, tool, tool origin,
 *      scopes, optional document snapshot }, get back a single-use grant_id with a
 *      short TTL.
 *   2. taskpane opens the tool at `https://tool.example/#wt_grant=<grant_id>` — a URL
 *      *fragment*, so the grant never reaches the tool's server or intermediary logs.
 *   3. tool → POST /api/handoff/exchange { grant_id }: swap the grant for a bearer
 *      token (scoped to that tool) plus the document snapshot. The caller's `Origin`
 *      must match the origin recorded in step 1.
 *
 * The grant is bound to a *tool at an origin*, and the origin comes from the launch
 * URL the taskpane actually resolved — not from a server-side registry of tool
 * origins. A registry would have to answer "what origin is `mindmap`?", which has no
 * single answer (dev builds launch localhost, prod launches the deployed host), so it
 * would duplicate the frontend's own URL resolution and drift from it. Recording what
 * was launched is both lighter and more accurate.
 *
 * The bearer token issued here is our own opaque credential, prefixed `wtk_` so
 * app.ts's resolveUser can tell it apart from a Better Auth session token and
 * resolve it here instead. It carries the tool's client_id, so every LLM
 * completion and log line the tool produces is attributed to (user, tool) for free.
 *
 * We deliberately do NOT mint a Better Auth session for the tool: Better Auth has
 * no server-side "create a session for this user" primitive, and a parallel token
 * table keeps the tool's reach explicit (scopes, per-token revoke) and keeps this
 * whole flow testable without standing up auth. The pure device flow
 * (frontend/src/api/deviceAuth.ts) remains the fallback for tools opened directly.
 */
import { randomBytes } from 'node:crypto';
import type { SessionUser } from './auth.js';
import { db } from './db.js';

/**
 * Scopes a tool may request. Recorded and surfaced now (the future consent screen
 * and Phase 3 enforcement read them); in this sa phase the proxy still
 * treats a valid tool token as a full session token, except where a scope check is
 * the natural gate — the document re-fetch requires `doc:read`.
 */
export const TOOL_SCOPES = [
	'openai:chat',
	'log:write',
	'doc:read',
	'doc:write',
] as const;
export type ToolScope = (typeof TOOL_SCOPES)[number];

/** Scopes granted when a launch request names none. */
export const DEFAULT_TOOL_SCOPES: ToolScope[] = [
	'openai:chat',
	'log:write',
	'doc:read',
];

export function isToolScope(value: unknown): value is ToolScope {
	return (
		typeof value === 'string' && (TOOL_SCOPES as readonly string[]).includes(value)
	);
}

/**
 * Normalize a launch URL to the origin a grant is bound to, or null if it isn't an
 * http(s) URL. The taskpane sends the URL it is about to open and we derive the origin
 * here, so normalization (default ports, case, trailing path) happens in exactly one
 * place and both sides of the comparison are produced the same way.
 */
export function originOfLaunchUrl(url: unknown): string | null {
	if (typeof url !== 'string') return null;
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
	return parsed.origin;
}

/** How long a freshly minted grant_id may be exchanged for a token. */
export const GRANT_TTL_MS = 2 * 60 * 1000; // 2 minutes
/** How long the exchanged bearer token stays valid. */
export const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** The identity captured on the grant — the full SessionUser minus its clientId
 *  (clientId is the grant's own tool_client_id, added back on resolve). */
type GrantUser = Omit<SessionUser, 'clientId'>;

function randomId(prefix: string): string {
	return `${prefix}${randomBytes(24).toString('base64url')}`;
}

export interface CreateGrantInput {
	user: GrantUser;
	toolClientId: string;
	/**
	 * Origin the taskpane is launching the tool at (from `originOfLaunchUrl`). The
	 * exchange only honours this grant when the caller's `Origin` matches, so a grant
	 * that leaks — or is relayed to an attacker's page — can't be redeemed elsewhere.
	 */
	toolOrigin: string;
	scopes: ToolScope[];
	/** DocContext snapshot to hand the tool, or null. Stored opaquely as JSON. */
	docSnapshot: unknown;
}

export interface CreatedGrant {
	grantId: string;
	/** Seconds until the grant_id can no longer be exchanged. */
	expiresIn: number;
}

/** Stash a launch grant. Called from the authenticated POST /api/handoff route. */
export function createToolGrant(input: CreateGrantInput): CreatedGrant {
	const grantId = randomId('wtg_');
	const now = Date.now();
	const expiresAt = now + GRANT_TTL_MS;
	db()
		.prepare(
			`INSERT INTO tool_grant (
				grant_id, access_token, user_snapshot, tool_client_id, tool_origin, scopes,
				doc_snapshot, created_at, expires_at
			) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.run(
			grantId,
			JSON.stringify(input.user),
			input.toolClientId,
			input.toolOrigin,
			JSON.stringify(input.scopes),
			input.docSnapshot === undefined ? null : JSON.stringify(input.docSnapshot),
			now,
			expiresAt,
		);
	return { grantId, expiresIn: Math.floor(GRANT_TTL_MS / 1000) };
}

interface GrantRow {
	grant_id: string;
	access_token: string | null;
	user_snapshot: string;
	tool_client_id: string;
	tool_origin: string | null;
	scopes: string;
	doc_snapshot: string | null;
	created_at: number;
	expires_at: number;
	exchanged_at: number | null;
	token_expires_at: number | null;
	revoked_at: number | null;
}

export type ExchangeResult =
	| {
			ok: true;
			accessToken: string;
			expiresIn: number;
			user: GrantUser;
			clientId: string;
			scopes: ToolScope[];
			doc: unknown;
	  }
	| {
			ok: false;
			error: 'not_found' | 'expired' | 'already_used' | 'origin_mismatch';
	  };

/**
 * Swap a grant_id for a bearer token. Single-use: the first successful exchange
 * mints the token and marks the grant; any later attempt is refused. Called from
 * the unauthenticated POST /api/handoff/exchange route — the grant_id itself is the
 * credential, so no session is required (and the tool doesn't have one yet).
 *
 * `requestOrigin` is the caller's `Origin` header, which must equal the origin the
 * grant was minted for. That binding is what stops a relayed grant being redeemed by
 * a page other than the tool the user launched. Every caller of this route is a
 * browser (the grant only ever arrives via a URL fragment, which nothing but a
 * navigation can deliver) and the request is a JSON POST, so it is preflighted and
 * `Origin` is always present — a missing one is refused rather than waved through.
 * A mismatch deliberately does *not* consume the grant: the legitimate tool must
 * still be able to redeem it.
 */
export function exchangeToolGrant(
	grantId: string,
	requestOrigin: string | null | undefined,
): ExchangeResult {
	const conn = db();
	// Serialize the read-decide-write so two racing exchanges can't both succeed.
	const tx = conn.transaction((): ExchangeResult => {
		const row = conn
			.prepare(`SELECT * FROM tool_grant WHERE grant_id = ?`)
			.get(grantId) as GrantRow | undefined;
		if (!row) return { ok: false, error: 'not_found' };
		if (row.exchanged_at !== null) return { ok: false, error: 'already_used' };
		if (Date.now() > row.expires_at) return { ok: false, error: 'expired' };
		if (!row.tool_origin || !requestOrigin || requestOrigin !== row.tool_origin) {
			return { ok: false, error: 'origin_mismatch' };
		}

		const now = Date.now();
		const accessToken = randomId('wtk_');
		const tokenExpiresAt = now + TOKEN_TTL_MS;
		conn
			.prepare(
				`UPDATE tool_grant
					SET access_token = ?, exchanged_at = ?, token_expires_at = ?
					WHERE grant_id = ?`,
			)
			.run(accessToken, now, tokenExpiresAt, grantId);

		return {
			ok: true,
			accessToken,
			expiresIn: Math.floor(TOKEN_TTL_MS / 1000),
			user: JSON.parse(row.user_snapshot) as GrantUser,
			clientId: row.tool_client_id,
			scopes: JSON.parse(row.scopes) as ToolScope[],
			doc: row.doc_snapshot === null ? null : JSON.parse(row.doc_snapshot),
		};
	});
	return tx();
}

/** A live token's row, or null when the token is unknown/expired/revoked. */
function liveTokenRow(token: string): GrantRow | null {
	const row = db()
		.prepare(`SELECT * FROM tool_grant WHERE access_token = ?`)
		.get(token) as GrantRow | undefined;
	if (!row || row.revoked_at !== null) return null;
	if (row.token_expires_at !== null && Date.now() > row.token_expires_at) {
		return null;
	}
	return row;
}

export interface ResolvedToolToken {
	user: SessionUser;
	scopes: ToolScope[];
}

/**
 * Resolve a `wtk_` bearer token to the identity behind it, with clientId set to the
 * tool the grant was issued for. Returns null for any unknown, expired, or revoked
 * token. This is what lets a tool's requests flow through the LLM proxy and log
 * endpoints under the user's account.
 */
export function resolveToolToken(token: string): ResolvedToolToken | null {
	const row = liveTokenRow(token);
	if (!row) return null;
	const user = JSON.parse(row.user_snapshot) as GrantUser;
	return {
		user: { ...user, clientId: row.tool_client_id },
		scopes: JSON.parse(row.scopes) as ToolScope[],
	};
}

/**
 * The document snapshot behind a live token, for the optional re-fetch endpoint.
 * Returns null (no snapshot) vs. undefined (invalid token) so the caller can 401
 * on the latter.
 */
export function getToolTokenDoc(token: string): { doc: unknown } | undefined {
	const row = liveTokenRow(token);
	if (!row) return undefined;
	return { doc: row.doc_snapshot === null ? null : JSON.parse(row.doc_snapshot) };
}

/** Disconnect a tool: revoke its token. Returns false if the token was unknown. */
export function revokeToolToken(token: string): boolean {
	const info = db()
		.prepare(
			`UPDATE tool_grant SET revoked_at = ?
				WHERE access_token = ? AND revoked_at IS NULL`,
		)
		.run(Date.now(), token);
	return info.changes > 0;
}
