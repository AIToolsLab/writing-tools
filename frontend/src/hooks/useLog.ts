/**
 * Consent-aware, authenticated event logging.
 *
 * Replaces the old anonymous `log()` in @/api. The server now derives identity
 * from the session and requires a Bearer token, so logging must run inside the
 * auth context. This hook:
 *   - strips consent buckets above the user's level (see @/consent), so we never
 *     transmit more than they allowed (the server re-checks authoritatively);
 *   - drops the event entirely at level `none`;
 *   - stamps `doc_id` and `session_id` (see @/api/logIdentity) — after the
 *     consent check, so a `none` writer's document is never given an id;
 *   - attaches the access token; no-ops silently when the user isn't signed in.
 *
 * Logging is best-effort and never throws into the UI.
 */
import { useCallback, useContext } from 'react';
import { SERVER_URL } from '@/api';
import { DEVICE_CLIENT_ID } from '@/api/deviceAuth';
import { getOrCreateDocId, LOG_SESSION_ID } from '@/api/logIdentity';
import { filterBucketsForConsent, type LogBuckets } from '@/consent';
import { useAppAuth } from '@/contexts/appAuthContext';
import { EditorContext } from '@/contexts/editorContext';

/**
 * One event: the envelope plus its payload, already sorted into consent
 * buckets. There is deliberately no index signature — a field outside a bucket
 * is a type error here and is dropped by the server.
 */
export interface LogEvent extends LogBuckets {
	event: string;
	page: string;
	schema_version: number;
}

export type LogFn = (payload: LogEvent) => Promise<void>;

export function useLog(): LogFn {
	const { getAccessToken, loggingConsent } = useAppAuth();
	const editorAPI = useContext(EditorContext);

	return useCallback<LogFn>(
		async (payload) => {
			const { event, page, schema_version, ...buckets } = payload;
			const { allowed, buckets: filtered } = filterBucketsForConsent(
				buckets,
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

			const docId = await getOrCreateDocId(editorAPI);

			try {
				const res = await fetch(`${SERVER_URL}/log`, {
					method: 'POST',
					credentials: 'omit',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
						// Attribute first-party add-in events to (user, add-in).
						'X-Client-Id': DEVICE_CLIENT_ID,
					},
					body: JSON.stringify({
						event,
						page,
						schema_version,
						doc_id: docId,
						session_id: LOG_SESSION_ID,
						...filtered,
						timestamp: Date.now() / 1000,
					}),
				});
				// fetch only rejects on network failure, so a rejected auth (e.g. a 401
				// after a session/consent regression) would otherwise be invisible.
				// Surface non-2xx instead of silently dropping the event.
				if (!res.ok) {
					console.warn(
						`event logging rejected: /api/log returned ${res.status}`,
					);
				}
			} catch {
				// Best-effort; never disrupt the UI on a logging failure.
			}
		},
		[getAccessToken, loggingConsent, editorAPI],
	);
}
