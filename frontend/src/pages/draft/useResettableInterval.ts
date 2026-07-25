import { useCallback, useEffect, useEffectEvent, useState } from 'react';

/**
 * Call a callback function at a specified interval, with the ability to reset the interval.
 *
 * @param callback The function to be called on each interval.
 * @param interval The interval duration in milliseconds. Values <= 0 schedule nothing.
 * @returns A function to reset the interval (tears down and restarts the timer).
 */
export function useResettableInterval(callback: () => void, interval: number) {
	// `callback` changes identity on every render, but it should NOT resubscribe the
	// interval. useEffectEvent gives us a stable tick that always invokes the latest
	// callback, so the effect depends only on the actual reactive inputs. This replaces
	// the old callbackRef + mirror-effect dance (fragile: easy to read a stale ref).
	const onTick = useEffectEvent(callback);

	// Reset re-runs the effect (tearing down and recreating the interval) by bumping a
	// nonce, keeping every setInterval call inside the single effect.
	const [resetNonce, setResetNonce] = useState(0);

	useEffect(() => {
		if (interval <= 0) return;
		const timer = setInterval(() => {
			onTick();
		}, interval);
		return () => clearInterval(timer);
	}, [interval, resetNonce]);

	return useCallback(() => setResetNonce((n) => n + 1), []);
}
