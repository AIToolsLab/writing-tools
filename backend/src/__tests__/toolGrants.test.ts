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

function mint(docSnapshot: unknown = undefined) {
	return createToolGrant({
		user: USER,
		toolClientId: 'mindmap',
		scopes: ['openai:chat', 'doc:read'],
		docSnapshot,
	});
}

describe('createToolGrant / exchangeToolGrant', () => {
	it('exchanges a fresh grant for a wtk_ token carrying the identity, scopes and doc', () => {
		const { grantId } = mint({ beforeCursor: 'hello', selectedText: '', afterCursor: '' });
		const result = exchangeToolGrant(grantId);

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
		expect(exchangeToolGrant(grantId).ok).toBe(true);

		const second = exchangeToolGrant(grantId);
		expect(second.ok).toBe(false);
		if (second.ok) return;
		expect(second.error).toBe('already_used');
	});

	it('rejects an unknown grant', () => {
		const r = exchangeToolGrant('wtg_nope');
		expect(r).toEqual({ ok: false, error: 'not_found' });
	});

	it('rejects an expired grant', () => {
		vi.useFakeTimers();
		const { grantId } = mint();
		vi.advanceTimersByTime(GRANT_TTL_MS + 1);

		const r = exchangeToolGrant(grantId);
		expect(r).toEqual({ ok: false, error: 'expired' });
	});

	it('returns doc: null when no snapshot was shared', () => {
		const { grantId } = mint(); // no doc
		const r = exchangeToolGrant(grantId);
		expect(r.ok && r.doc).toBeNull();
	});
});

describe('resolveToolToken', () => {
	it('resolves a live token to the user with the tool as clientId', () => {
		const { grantId } = mint();
		const ex = exchangeToolGrant(grantId);
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
		const ex = exchangeToolGrant(grantId);
		if (!ex.ok) throw new Error('exchange failed');

		vi.advanceTimersByTime(TOKEN_TTL_MS + 1);
		expect(resolveToolToken(ex.accessToken)).toBeNull();
	});
});

describe('getToolTokenDoc / revokeToolToken', () => {
	it('re-fetches the stored snapshot for a live token', () => {
		const { grantId } = mint({ beforeCursor: 'ctx', selectedText: '', afterCursor: '' });
		const ex = exchangeToolGrant(grantId);
		if (!ex.ok) throw new Error('exchange failed');

		expect(getToolTokenDoc(ex.accessToken)).toEqual({
			doc: { beforeCursor: 'ctx', selectedText: '', afterCursor: '' },
		});
		expect(getToolTokenDoc('wtk_unknown')).toBeUndefined();
	});

	it('revokes a token so it no longer resolves', () => {
		const { grantId } = mint();
		const ex = exchangeToolGrant(grantId);
		if (!ex.ok) throw new Error('exchange failed');

		expect(revokeToolToken(ex.accessToken)).toBe(true);
		expect(resolveToolToken(ex.accessToken)).toBeNull();
		// A second revoke is a no-op.
		expect(revokeToolToken(ex.accessToken)).toBe(false);
	});
});
