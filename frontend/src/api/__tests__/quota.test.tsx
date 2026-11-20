// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
	busiestWindow,
	noteQuotaHeader,
	parseQuotaStatus,
	QUOTA_STATE_HEADER,
	resetQuotaSignal,
	type QuotaStatus,
	useQuotaSignal,
} from '../quota';
import { quotaNoticeMessage } from '@/components/quotaNotice';

const status = (daily: number, weekly: number): QuotaStatus => ({
	capped: true,
	state: 'nearing',
	daily: { percentUsed: daily, resetsAt: '2026-11-21T12:00:00.000Z' },
	weekly: { percentUsed: weekly, resetsAt: '2026-11-23T12:00:00.000Z' },
	resetsAt: '2026-11-23T12:00:00.000Z',
});

afterEach(() => {
	resetQuotaSignal();
});

describe('parseQuotaStatus', () => {
	it('accepts the /api/me/quota shape', () => {
		const parsed = parseQuotaStatus({
			capped: true,
			state: 'fallback',
			daily: { percentUsed: 104, resetsAt: '2026-11-21T12:00:00.000Z' },
			weekly: { percentUsed: 60, resetsAt: '2026-11-23T12:00:00.000Z' },
			resetsAt: '2026-11-21T12:00:00.000Z',
			fallbackModel: 'gpt-6-luna',
		});
		expect(parsed.state).toBe('fallback');
		expect(parsed.daily?.percentUsed).toBe(104);
	});

	it('accepts an uncapped account', () => {
		const parsed = parseQuotaStatus({
			capped: false,
			state: 'ok',
			daily: null,
			weekly: null,
			resetsAt: null,
		});
		expect(parsed).toMatchObject({ capped: false, daily: null });
	});

	it('rejects a malformed body', () => {
		expect(() => parseQuotaStatus({ state: 'sideways' })).toThrow();
	});
});

describe('noteQuotaHeader / useQuotaSignal', () => {
	const withHeader = (value: string) =>
		new Response(null, { headers: { [QUOTA_STATE_HEADER]: value } });

	it('publishes the state a model response reported', () => {
		const { result } = renderHook(() => useQuotaSignal());
		expect(result.current).toBeNull();

		act(() => noteQuotaHeader(withHeader('nearing')));
		expect(result.current).toBe('nearing');

		act(() => noteQuotaHeader(withHeader('fallback')));
		expect(result.current).toBe('fallback');
	});

	it('ignores responses without the header, and unknown values', () => {
		const { result } = renderHook(() => useQuotaSignal());
		act(() => noteQuotaHeader(withHeader('ok')));
		act(() => noteQuotaHeader(new Response(null)));
		act(() => noteQuotaHeader(withHeader('sideways')));
		expect(result.current).toBe('ok');
	});
});

describe('busiestWindow', () => {
	it('picks the more-used window', () => {
		expect(busiestWindow(status(90, 40))?.label).toBe('today');
		expect(busiestWindow(status(30, 85))?.label).toBe('this week');
	});
});

describe('quotaNoticeMessage', () => {
	it('names the percentage and the window when nearing', () => {
		const message = quotaNoticeMessage('nearing', status(30, 85));
		expect(message).toContain('85%');
		expect(message).toContain('this week');
		expect(message).toMatch(/smaller model/);
	});

	it('still says something useful before the detail has loaded', () => {
		expect(quotaNoticeMessage('fallback', null)).toMatch(/smaller/);
	});

	it('never mentions dollars', () => {
		for (const state of ['nearing', 'fallback', 'blocked'] as const) {
			expect(quotaNoticeMessage(state, status(95, 99))).not.toMatch(/\$/);
		}
	});
});
