import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../db.js';
import {
	createToolGrant,
	exchangeToolGrant,
	GRANT_TTL_MS,
	getToolTokenDoc,
	originOfLaunchUrl,
	resolveToolToken,
	revokeToolToken,
	TOKEN_TTL_MS,
} from '../toolGrants.js';

const env = { ...process.env };

beforeEach(async () => {
	process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'wt-grants-'));
});

afterEach(() => {
	vi.useRealTimers();
	closeDb();
	process.env = { ...env };
});

const USER = {
	id: 'usr-1',
	loggingConsent: 'usage' as const,
	isAnonymous: false,
	isAllowed: true,
};

const TOOL_ORIGIN = 'https://tool.example';

function mint(docSnapshot: unknown = undefined) {
	return createToolGrant({
		user: USER,
		toolClientId: 'mindmap',
		toolOrigin: TOOL_ORIGIN,
		scopes: ['openai:chat', 'doc:read'],
		docSnapshot,
	});
}

/**
 * Redeem from the origin the grant was minted for, unless a test says otherwise.
 * `null` stands for "the request carried no Origin header at all".
 */
function redeem(grantId: string, origin: string | null = TOOL_ORIGIN) {
	return exchangeToolGrant(grantId, origin);
}

describe('createToolGrant / exchangeToolGrant', () => {
	it('exchanges a fresh grant for a wtk_ token carrying the identity, scopes and doc', () => {
		const { grantId } = mint({ beforeCursor: 'hello', selectedText: '', afterCursor: '' });
		const result = redeem(grantId);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.accessToken).toMatch(/^wtk_/);
		expect(result.clientId).toBe('mindmap');
		expect(result.scopes).toEqual(['openai:chat', 'doc:read']);
		expect(result.user.id).toBe('usr-1');
		expect(result.doc).toEqual({ beforeCursor: 'hello', selectedText: '', afterCursor: '' });
		expect(result.expiresIn).toBe(Math.floor(TOKEN_TTL_MS / 1000));
	});

	it('is single-use — a second exchange is refused', () => {
		const { grantId } = mint();
		expect(redeem(grantId).ok).toBe(true);

		const second = redeem(grantId);
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.error).toBe('already_used');
	});

	it('rejects an unknown grant', () => {
		const r = redeem('wtg_nope');
		expect(r).toEqual({ ok: false, error: 'not_found' });
	});

	it('rejects an expired grant', () => {
		vi.useFakeTimers();
		const { grantId } = mint();
		vi.advanceTimersByTime(GRANT_TTL_MS + 1);

		const r = redeem(grantId);
		expect(r).toEqual({ ok: false, error: 'expired' });
	});

	it('returns doc: null when no snapshot was shared', () => {
		const { grantId } = mint(); // no doc
		const r = redeem(grantId);
		expect(r.ok && r.doc).toBeNull();
	});

	it.each([
		['a different origin', 'https://evil.example'],
		['a scheme downgrade', 'http://tool.example'],
		['a non-default port', 'https://tool.example:8443'],
		['a subdomain', 'https://sub.tool.example'],
		['an empty Origin', ''],
		['no Origin header', null],
	])('refuses %s', (_label, origin) => {
		const { grantId } = mint();
		expect(redeem(grantId, origin)).toEqual({ ok: false, error: 'origin_mismatch' });
	});

	it('leaves the grant redeemable after a refused attempt', () => {
		const { grantId } = mint();
		expect(redeem(grantId, 'https://evil.example').ok).toBe(false);
		expect(redeem(grantId).ok).toBe(true);
	});
});

describe('originOfLaunchUrl', () => {
	it.each([
		['https://tool.example/app/?q=1#frag', 'https://tool.example'],
		['http://localhost:5181/', 'http://localhost:5181'],
		// Default ports normalize away, so the stored and compared forms agree.
		['https://tool.example:443/x', 'https://tool.example'],
	])('reduces %s to %s', (url, origin) => {
		expect(originOfLaunchUrl(url)).toBe(origin);
	});

	it.each([undefined, null, 42, '', 'not a url', 'javascript:alert(1)', 'file:///etc/passwd'])(
		'rejects %p',
		(url) => {
			expect(originOfLaunchUrl(url)).toBeNull();
		},
	);
});

describe('resolveToolToken', () => {
	it('resolves a live token to the user with the tool as clientId', () => {
		const { grantId } = mint();
		const ex = redeem(grantId);
		if (!ex.ok) throw new Error('exchange failed');

		const resolved = resolveToolToken(ex.accessToken);
		expect(resolved?.user.id).toBe('usr-1');
		expect(resolved?.user.clientId).toBe('mindmap');
		expect(resolved?.user.isAllowed).toBe(true);
		expect(resolved?.scopes).toContain('doc:read');
	});

	it('returns null for an unexchanged, unknown, or non-wtk token', () => {
		const { grantId } = mint();
		// grantId is not an access token
		expect(resolveToolToken(grantId)).toBeNull();
		expect(resolveToolToken('wtk_bogus')).toBeNull();
	});

	it('returns null once the token has expired', () => {
		vi.useFakeTimers();
		const { grantId } = mint();
		const ex = redeem(grantId);
		if (!ex.ok) throw new Error('exchange failed');

		vi.advanceTimersByTime(TOKEN_TTL_MS + 1);
		expect(resolveToolToken(ex.accessToken)).toBeNull();
	});
});

describe('getToolTokenDoc / revokeToolToken', () => {
	it('re-fetches the stored snapshot for a live token', () => {
		const { grantId } = mint({ beforeCursor: 'ctx', selectedText: '', afterCursor: '' });
		const ex = redeem(grantId);
		if (!ex.ok) throw new Error('exchange failed');

		expect(getToolTokenDoc(ex.accessToken)).toEqual({
			doc: { beforeCursor: 'ctx', selectedText: '', afterCursor: '' },
		});
		expect(getToolTokenDoc('wtk_unknown')).toBeUndefined();
	});

	it('revokes a token so it no longer resolves', () => {
		const { grantId } = mint();
		const ex = redeem(grantId);
		if (!ex.ok) throw new Error('exchange failed');

		expect(revokeToolToken(ex.accessToken)).toBe(true);
		expect(resolveToolToken(ex.accessToken)).toBeNull();
		// A second revoke is a no-op.
		expect(revokeToolToken(ex.accessToken)).toBe(false);
	});
});
