// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useResettableInterval } from '../useResettableInterval';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('useResettableInterval', () => {
	it('invokes the callback once per interval', () => {
		const cb = vi.fn();
		renderHook(() => useResettableInterval(cb, 1000));

		act(() => vi.advanceTimersByTime(1000));
		expect(cb).toHaveBeenCalledTimes(1);

		act(() => vi.advanceTimersByTime(2000));
		expect(cb).toHaveBeenCalledTimes(3);
	});

	it('does not resubscribe when the callback identity changes, and calls the latest callback', () => {
		// This is the core guarantee of the useEffectEvent refactor: a fresh callback
		// on every render must not tear down and restart the timer. We prove the timer
		// keeps running across a rerender by splitting one interval around it.
		const cb1 = vi.fn();
		const cb2 = vi.fn();
		const { rerender } = renderHook(
			({ cb }) => useResettableInterval(cb, 1000),
			{ initialProps: { cb: cb1 } },
		);

		act(() => vi.advanceTimersByTime(600));
		rerender({ cb: cb2 });
		act(() => vi.advanceTimersByTime(400)); // 600 + 400 = one full interval

		// If the timer had resubscribed at the rerender, only 400ms would have elapsed
		// and nothing would fire. Instead it fires once, using the newest callback.
		expect(cb2).toHaveBeenCalledTimes(1);
		expect(cb1).not.toHaveBeenCalled();
	});

	it('reset() tears down and restarts the interval', () => {
		const cb = vi.fn();
		const { result } = renderHook(() => useResettableInterval(cb, 1000));

		act(() => vi.advanceTimersByTime(600));
		act(() => result.current()); // reset at 600ms into the cycle

		act(() => vi.advanceTimersByTime(600)); // 600ms since reset — not a full interval
		expect(cb).not.toHaveBeenCalled();

		act(() => vi.advanceTimersByTime(400)); // now 1000ms since reset
		expect(cb).toHaveBeenCalledTimes(1);
	});

	it('schedules nothing when the interval is <= 0', () => {
		const cb = vi.fn();
		renderHook(() => useResettableInterval(cb, 0));

		act(() => vi.advanceTimersByTime(100000));
		expect(cb).not.toHaveBeenCalled();
	});

	it('clears the interval on unmount', () => {
		const cb = vi.fn();
		const { unmount } = renderHook(() => useResettableInterval(cb, 1000));

		act(() => vi.advanceTimersByTime(600));
		unmount();
		act(() => vi.advanceTimersByTime(5000));
		expect(cb).not.toHaveBeenCalled();
	});
});
