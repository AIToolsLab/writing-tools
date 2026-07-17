/**
 * Consent-aware, authenticated event logging.
 *
 * Replaces the old anonymous `log()` in @/api. The server now derives identity
 * from the session and requires a Bearer token, so logging must run inside the
 * auth context. This hook:
 *   - strips content fields above the user's consent level (see @/consent), so we
 *     never transmit more than they allowed (the server re-checks authoritatively);
 *   - drops the event entirely at level `none`;
 *   - attaches the access token; no-ops silently when the user isn't signed in.
 *
 * Logging is best-effort and never throws into the UI.
 */
import { useCallback } from 'react';
import { SERVER_URL } from '@/api';
import { filterPayloadForConsent } from '@/consent';
import { useAppAuth } from '@/contexts/appAuthContext';

export interface LogEvent {
	event: string;
	// biome-ignore lint/suspicious/noExplicitAny: events carry arbitrary serializable fields
	[key: string]: any;
}

export type LogFn = (payload: LogEvent) => Promise<void>;

export function useLog(): LogFn {
	const { getAccessToken, loggingConsent } = useAppAuth();

	return useCallback<LogFn>(
		async (payload) => {
			const { allowed, payload: filtered } = filterPayloadForConsent(
				payload,
				loggingConsent,
			);
			if (!allowed) return;

			let token: string;
			try {
				token = await getAccessToken();
			} catch {
				// Not authenticated (e.g. login_required) — nothing to log against.
				return;
			}

			try {
				await fetch(`${SERVER_URL}/log`, {
					method: 'POST',
					credentials: 'omit',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ ...filtered, timestamp: Date.now() / 1000 }),
				});
			} catch {
				// Best-effort; never disrupt the UI on a logging failure.
			}
		},
		[getAccessToken, loggingConsent],
	);
}
