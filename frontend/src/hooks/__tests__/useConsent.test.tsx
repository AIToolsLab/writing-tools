// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { changeConsent, session } = vi.hoisted(() => ({
	changeConsent: vi.fn(),
	session: {
		getAccessToken: vi.fn(() => Promise.resolve('tok')),
		applyConsentSnapshot: vi.fn(),
	},
}));

vi.mock('@/api/account', () => ({ changeConsent }));
vi.mock('@/contexts/appAuthContext', () => ({ useAppAuth: () => session }));

import { useConsent } from '../useConsent';

describe('useConsent.save', () => {
	beforeEach(() => {
		changeConsent.mockReset();
		session.applyConsentSnapshot.mockReset();
	});

	it('applies the snapshot with the save’s token', async () => {
		const snapshot = {
			loggingConsent: 'ai_output',
			consentUpdatedAt: '2026-07-28T00:00:00.000Z',
		};
		changeConsent.mockResolvedValueOnce(snapshot);
		const { result } = renderHook(() => useConsent('usage'));

		let ok!: boolean;
		await act(async () => {
			ok = await result.current.save('ai_output');
		});

		expect(ok).toBe(true);
		expect(result.current.level).toBe('ai_output');
		expect(result.current.status).toBe('saved');
		expect(session.applyConsentSnapshot).toHaveBeenCalledWith(
			snapshot,
			'tok',
		);
	});

	it('rolls back the level and reports failure when the save fails', async () => {
		changeConsent.mockRejectedValueOnce(new Error('500'));
		const { result } = renderHook(() => useConsent('usage'));

		let ok!: boolean;
		await act(async () => {
			ok = await result.current.save('document');
		});

		expect(ok).toBe(false);
		expect(result.current.level).toBe('usage');
		expect(result.current.status).toBe('error');
		expect(session.applyConsentSnapshot).not.toHaveBeenCalled();
	});
});
