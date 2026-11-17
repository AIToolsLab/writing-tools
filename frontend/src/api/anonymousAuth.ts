/**
 * Better Auth anonymous sign-in (demo mode).
 *
 * Demo users get a real anonymous session rather than a fake token, so the whole
 * identity-keyed stack (event logging, consent, usage metering, PostHog identify)
 * works with no special-casing — see backend/src/auth.ts (anonymous plugin). Raw
 * fetch with `credentials: 'omit'`, matching deviceAuth.ts: the bearer token is the
 * only proof of identity, never a cookie.
 *
 * The token comes back in the `set-auth-token` response header (the bearer plugin's
 * contract). Frontend and backend are same-origin in every deployment (dev proxy and
 * the single prod container), so that response header is readable here.
 */
import { SERVER_URL } from './index';

/**
 * Create a fresh anonymous session and return its bearer token. Throws on a non-2xx
 * response or a missing token header (e.g. the backend is down / demo unavailable).
 */
export async function signInAnonymous(signal?: AbortSignal): Promise<string> {
	const res = await fetch(`${SERVER_URL}/auth/sign-in/anonymous`, {
		method: 'POST',
		credentials: 'omit',
		headers: { 'Content-Type': 'application/json' },
		body: '{}',
		signal,
	});
	if (!res.ok) {
		throw new Error(`sign-in/anonymous failed (${res.status})`);
	}
	const token = res.headers.get('set-auth-token');
	if (!token) {
		throw new Error('sign-in/anonymous returned no token');
	}
	return token;
}
