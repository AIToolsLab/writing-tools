import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../index', () => ({ SERVER_URL: '/api' }));

import { changeConsent, deleteAccount, eraseActivity } from '../account';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('account API', () => {
	it('uses the bearer-only path for consent changes', async () => {
		fetchMock.mockResolvedValueOnce({ ok: true } as Response);

		await changeConsent('tok', 'ai_output');

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

	it('uses the bearer-only path for activity erasure', async () => {
		fetchMock.mockResolvedValueOnce({ ok: true } as Response);

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
		} as Response);

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
		} as Response);

		await expect(deleteAccount('tok')).resolves.toEqual({
			ok: false,
			staleSession: false,
			status: 400,
		});
	});
});
