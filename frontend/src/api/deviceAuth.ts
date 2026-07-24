/**
 * Better Auth device authorization client (RFC 8628).
 *
 * Mirrors the proven backend taskpane simulator (backend/src/routes/device-taskpane.ts):
 * raw fetch with `credentials: 'omit'` throughout, so success depends only on the
 * Bearer token and never on cookies. No `better-auth` client dependency is needed.
 *
 * The interactive half (Google sign-in + approval) happens in the user's normal
 * browser at `verification_uri_complete`, which Better Auth builds from the backend's
 * BETTER_AUTH_URL. This module only requests the code and polls for the token.
 */
import {
	type ConsentLevel,
	DEFAULT_CONSENT_LEVEL,
	isConsentLevel,
} from '@/consent';
import { SERVER_URL } from './index';

// Supplied at build time via webpack DefinePlugin; must match a value in the backend's
// BETTER_AUTH_DEVICE_CLIENT_IDS allowlist.
export const DEVICE_CLIENT_ID =
	process.env.BETTER_AUTH_DEVICE_CLIENT_ID || 'writing-tools-editor-dev';

const GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

/** Successful response of POST /api/auth/device/code. */
export interface DeviceCodeResponse {
	device_code: string;
	user_code: string;
	verification_uri: string;
	verification_uri_complete: string;
	expires_in: number;
	interval: number;
}

/** Terminal outcomes of the polling loop. */
export type PollResult =
	| { type: 'token'; accessToken: string }
	| { type: 'denied' }
	| { type: 'expired' }
	| { type: 'aborted' }
	| { type: 'error'; message: string };

/**
 * Request a device + user code pair. `credentials: 'omit'` proves the token-only path.
 */
export async function requestDeviceCode(
	signal?: AbortSignal,
): Promise<DeviceCodeResponse> {
	const res = await fetch(`${SERVER_URL}/auth/device/code`, {
		method: 'POST',
		credentials: 'omit',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			client_id: DEVICE_CLIENT_ID,
			scope: 'openid profile email',
		}),
		signal,
	});
	const data = await res.json();
	if (!res.ok) {
		throw new Error(
			`device/code failed (${res.status}): ${JSON.stringify(data)}`,
		);
	}
	return data as DeviceCodeResponse;
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
	new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(new DOMException('Aborted', 'AbortError'));
			return;
		}
		const timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new DOMException('Aborted', 'AbortError'));
		};
		signal?.addEventListener('abort', onAbort, { once: true });
	});

/**
 * Poll POST /api/auth/device/token until the device request resolves.
 *
 * Honors the RFC 8628 error set: `authorization_pending` (keep waiting),
 * `slow_down` (add 5s to the interval), `access_denied`, and `expired_token`.
 * Cancellable via `signal` — aborting clears the pending timer so a stale tick can
 * never deliver a token after logout/reset.
 */

export async function pollForToken(
	deviceCode: string,
	intervalSeconds: number,
	signal?: AbortSignal,
): Promise<PollResult> {
	let interval = intervalSeconds;

	while (true) {
		try {
			await sleep(interval * 1000, signal);
		} catch {
			return { type: 'aborted' };
		}

		let res: Response;
		try {
			res = await fetch(`${SERVER_URL}/auth/device/token`, {
				method: 'POST',
				credentials: 'omit',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					grant_type: GRANT_TYPE,
					device_code: deviceCode,
					client_id: DEVICE_CLIENT_ID,
				}),
				signal,
			});
		} catch (e) {
			if (signal?.aborted) return { type: 'aborted' };
			return { type: 'error', message: (e as Error).message };
		}

		const data = await res.json();

		if (res.ok && data.access_token) {
			return { type: 'token', accessToken: data.access_token as string };
		}

		switch (data.error) {
			case 'authorization_pending':
				break;
			case 'slow_down':
				interval += 5;
				break;
			case 'access_denied':
				return { type: 'denied' };
			case 'expired_token':
				return { type: 'expired' };
			default:
				return {
					type: 'error',
					message: JSON.stringify(data),
				};
		}
	}
}

/** Authenticated user shape, mapped from Better Auth's GET /api/auth/get-session. */
export interface UserInfo {
	/** Better Auth user id — stable identity for analytics + log keying. */
	id?: string;
	email?: string;
	name?: string;
	/** Logging-consent level; gates analytics + event logging on the client. */
	loggingConsent?: ConsentLevel;
	/**
	 * Beta access decision, computed server-side (customSession → userAllowlist.ts).
	 * The client renders its "not allowed" screen from this rather than re-encoding
	 * the allowlist policy.
	 */
	isAllowed?: boolean;
	/**
	 * Demo/anonymous session (see the anonymous plugin in backend/src/auth.ts).
	 * Surfaces so account/consent surfaces can steer these users to real sign-in
	 * rather than letting them manage consent on a throwaway identity.
	 */
	isAnonymous?: boolean;
}

/**
 * Raw body of GET /api/auth/get-session. `user` carries our `additionalFields`
 * (loggingConsent) uncoerced, so treat loggingConsent as unknown until validated.
 * An absent/expired session yields `null` (HTTP 200), not this object.
 */
interface GetSessionResponse {
	user: {
		id?: string;
		email?: string;
		name?: string;
		loggingConsent?: unknown;
		isAllowed?: unknown;
		isAnonymous?: unknown;
	};
}

/**
 * Verify a Bearer token and fetch the signed-in user via Better Auth's session
 * endpoint. `credentials: 'omit'` keeps this on the token-only path (the bearer
 * plugin converts the Bearer token into the session cookie server-side).
 *
 * Note: get-session returns HTTP 200 with a `null` body for an absent/expired/
 * invalid session — NOT a 401. We throw in that case so callers (useDeviceAuth's
 * hydrate-on-mount) still detect a stale token and fall back to login.
 */
export async function fetchUserInfo(
	accessToken: string,
	signal?: AbortSignal,
): Promise<UserInfo> {
	const res = await fetch(`${SERVER_URL}/auth/get-session`, {
		credentials: 'omit',
		headers: { Authorization: `Bearer ${accessToken}` },
		signal,
	});
	// A non-2xx here is a genuine transport/server failure.
	if (!res.ok) {
		throw new Error(`get-session failed (${res.status})`);
	}
	const data = (await res.json()) as GetSessionResponse | null;
	// `null` (or a body missing `user`) = the token no longer resolves to a
	// session. Mirror the old 401 so the stale-token path still fires.
	if (!data?.user) {
		throw new Error('get-session: no active session');
	}
	const {
		id,
		email,
		name,
		loggingConsent: raw,
		isAllowed,
		isAnonymous,
	} = data.user;
	return {
		id,
		email,
		name,
		// get-session returns the stored value uncoerced; /api/protected used to
		// normalize server-side, so we replicate that guard client-side.
		loggingConsent: isConsentLevel(raw) ? raw : DEFAULT_CONSENT_LEVEL,
		isAllowed: isAllowed === true,
		isAnonymous: isAnonymous === true,
	};
}

/**
 * Best-effort Better Auth sign-out using the Bearer token. Returns true if the server
 * acknowledged. Whether this actually invalidates the device-issued session must be
 * verified manually (see plan logout semantics).
 */
export async function signOut(accessToken: string): Promise<boolean> {
	try {
		const res = await fetch(`${SERVER_URL}/auth/sign-out`, {
			method: 'POST',
			credentials: 'omit',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${accessToken}`,
			},
			body: '{}',
		});
		return res.ok;
	} catch {
		return false;
	}
}
