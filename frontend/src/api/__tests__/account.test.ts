import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../index', () => ({ SERVER_URL: '/api' }));

import {
	accountPageUrl,
	changeConsent,
	deleteAccount,
	eraseActivity,
} from '../account';

let fetchMock: ReturnType<typeof vi.fn>;

describe('accountPageUrl', () => {
	it('points at the backend origin, not the page origin', () => {
		// Google Docs sidebar: SERVER_URL comes from the bundle's script src.
		expect(accountPageUrl('https://app.thoughtful-ai.com/api')).toBe(
			'https://app.thoughtful-ai.com/account.html',
		);
		// Task pane / editor, and the relative URL tests use.
		expect(accountPageUrl('https://localhost:3000/api')).toBe(
			'https://localhost:3000/account.html',
		);
		expect(accountPageUrl()).toBe('/account.html');
	});
});

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('account API', () => {
	it('uses the bearer-only path for consent changes', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () =>
				Promise.resolve({
					loggingConsent: 'ai_output',
					consentUpdatedAt: '2026-07-27T00:00:00.000Z',
				}),
		});

		await expect(changeConsent('tok', 'ai_output')).resolves.toEqual({
			loggingConsent: 'ai_output',
			consentUpdatedAt: '2026-07-27T00:00:00.000Z',
		});

		expect(fetchMock).toHaveBeenCalledWith('/api/me/consent', {
			method: 'POST',
			credentials: 'omit',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer tok',
			},
			body: JSON.stringify({ level: 'ai_output' }),
		});
	});

	// A 2xx with a body we can't trust is a failed save: the caller rolls back
	// rather than pushing an unknown level or a missing marker into the session.
	it.each([
		[
			'unknown level',
			{ loggingConsent: 'everything', consentUpdatedAt: 'x' },
		],
		['missing timestamp', { loggingConsent: 'usage' }],
		[
			'non-string timestamp',
			{ loggingConsent: 'usage', consentUpdatedAt: 1 },
		],
	])('rejects a malformed consent snapshot (%s)', async (_label, body) => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: () => Promise.resolve(body),
		});
		await expect(changeConsent('tok', 'usage')).rejects.toThrow(
			'invalid snapshot',
		);
	});

	it('uses the bearer-only path for activity erasure', async () => {
		fetchMock.mockResolvedValueOnce({ ok: true });

		await eraseActivity('tok');

		expect(fetchMock).toHaveBeenCalledWith('/api/me/activity', {
			method: 'DELETE',
			credentials: 'omit',
			headers: { Authorization: 'Bearer tok' },
		});
	});

	it('recognizes only Better Auth SESSION_EXPIRED as stale', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 400,
			json: () => Promise.resolve({ code: 'SESSION_EXPIRED' }),
		});

		await expect(deleteAccount('tok')).resolves.toEqual({
			ok: false,
			staleSession: true,
			status: 400,
		});
	});

	it('does not treat unrelated 400 responses as stale', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 400,
			json: () => Promise.resolve({ code: 'INVALID_PASSWORD' }),
		});

		await expect(deleteAccount('tok')).resolves.toEqual({
			ok: false,
			staleSession: false,
			status: 400,
		});
	});
});
