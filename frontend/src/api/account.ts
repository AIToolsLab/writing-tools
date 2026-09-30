/**
 * Authenticated account/consent actions for the standalone account page.
 *
 * Raw fetch + Bearer, `credentials: 'omit'` throughout — the same token-only path
 * the rest of the device-auth client uses (see deviceAuth.ts). No better-auth
 * client dependency.
 */
import { SERVER_URL } from '@/api';
import { isConsentLevel, type ConsentLevel } from '@/consent';

function authedFetch(
	path: string,
	token: string,
	init: Omit<RequestInit, 'headers'> & {
		headers?: Record<string, string>;
	} = {},
): Promise<Response> {
	return fetch(`${SERVER_URL}${path}`, {
		...init,
		credentials: 'omit',
		headers: {
			...(init.headers ?? {}),
			Authorization: `Bearer ${token}`,
		},
	});
}

/**
 * Change the signed-in user's logging-consent level.
 * `POST /api/me/consent { level }` → the authoritative consent snapshot. Throws
 * on a non-2xx response or malformed response body.
 */
export interface ConsentSnapshot {
	loggingConsent: ConsentLevel;
	consentUpdatedAt: string;
}

export async function changeConsent(
	token: string,
	level: ConsentLevel,
): Promise<ConsentSnapshot> {
	const res = await authedFetch('/me/consent', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ level }),
	});
	if (!res.ok) {
		throw new Error(`consent update failed (${res.status})`);
	}
	const data = (await res.json()) as {
		loggingConsent?: unknown;
		consentUpdatedAt?: unknown;
	};
	if (
		!isConsentLevel(data.loggingConsent) ||
		typeof data.consentUpdatedAt !== 'string'
	) {
		throw new Error('consent update returned an invalid snapshot');
	}
	return {
		loggingConsent: data.loggingConsent,
		consentUpdatedAt: data.consentUpdatedAt,
	};
}

/**
 * Withdrawal: erase the user's logged activity + analytics profile, keeping
 * the account (usage/billing records deliberately survive — see erasure.ts).
 * `DELETE /api/me/activity`. Throws on non-2xx.
 */
export async function eraseActivity(token: string): Promise<void> {
	const res = await authedFetch('/me/activity', token, { method: 'DELETE' });
	if (!res.ok) {
		throw new Error(`erase activity failed (${res.status})`);
	}
}

export type DeleteAccountResult =
	| { ok: true }
	/**
	 * `staleSession` is true when Better Auth's delete-user rejected because the
	 * session isn't fresh (freshAge, default 1 day). Our Google-only accounts have
	 * no password and no email-verification flow, so this requires a fresh sign-in.
	 */
	| { ok: false; staleSession: boolean; status: number };

/**
 * Departure: delete the account. `beforeDelete` (auth.ts) runs the same erasure as
 * withdrawal plus usage anonymization, then Better Auth drops the account/sessions.
 * `POST /api/auth/delete-user` — no password/token, so it succeeds only on a fresh
 * session (see DeleteAccountResult.staleSession).
 */
export async function deleteAccount(
	token: string,
): Promise<DeleteAccountResult> {
	const res = await authedFetch('/auth/delete-user', token, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
	});
	if (res.ok) return { ok: true };
	// Better Auth error bodies are { code, message }; the freshness gate rejects
	// with 400 + code SESSION_EXPIRED specifically. Match on the code so an
	// unrelated 400 doesn't send the user around a pointless re-auth loop.
	let code: unknown;
	try {
		code = ((await res.json()) as { code?: unknown } | null)?.code;
	} catch {
		code = undefined;
	}
	return {
		ok: false,
		staleSession: res.status === 400 && code === 'SESSION_EXPIRED',
		status: res.status,
	};
}
