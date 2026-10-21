/**
 * Shared consent-change logic for both the onboarding consent gate and the
 * standalone account page, so they run one code path.
 *
 * `level` is optimistic local state. `save` POSTs the change, then refreshes the
 * session so `hasSetConsent`/`consentUpdatedAt` update live (a fresh real user's
 * first save is what dismisses the onboarding gate), and rolls back on failure.
 * `setLevel` lets a caller stage a choice locally and commit it later: the
 * onboarding gate picks first and commits on Continue, while the account page
 * wires `onChange` straight to `save` for immediate persistence.
 */
import { useCallback, useState } from 'react';
import { changeConsent } from '@/api/account';
import type { ConsentLevel } from '@/consent';
import { broadcastConsentChange } from '@/consentSync';
import { useAppAuth } from '@/contexts/appAuthContext';

export type ConsentStatus = 'idle' | 'saving' | 'saved' | 'error';

export function useConsent(initial: ConsentLevel) {
	const session = useAppAuth();
	const [level, setLevel] = useState<ConsentLevel>(initial);
	const [status, setStatus] = useState<ConsentStatus>('idle');

	// Returns whether the save succeeded, so a caller that gates on it (the
	// onboarding "Continue") only proceeds on success and keeps the gate up on
	// failure. A void-returning onChange (the account page) can ignore the result.
	const save = useCallback(
		async (next: ConsentLevel): Promise<boolean> => {
			const previous = level;
			setLevel(next); // optimistic
			setStatus('saving');
			try {
				const token = await session.getAccessToken();
				const snapshot = await changeConsent(token, next);
				// The save endpoint returns the values it just persisted, so update this
				// session directly. A transient get-session failure can no longer leave a
				// successfully-consented user trapped behind the onboarding gate.
				session.applyConsentSnapshot(snapshot);
				// Tell other same-origin tabs (e.g. the app tab, when this save happens
				// on the standalone account page) to refresh, so none keeps logging at a
				// level the user just lowered.
				broadcastConsentChange();
				setStatus('saved');
				return true;
			} catch {
				setLevel(previous); // roll back on failure
				setStatus('error');
				return false;
			}
		},
		[level, session],
	);

	return { level, setLevel, status, save };
}
