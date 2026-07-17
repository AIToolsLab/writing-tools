/**
 * Beta access allowlist — the single source of truth for who may use the add-in
 * during the closed trial.
 *
 * Real (non-anonymous) accounts are limited to Calvin email addresses plus one
 * example test user. Anonymous (demo) sessions are always allowed: they never reach
 * this gate in the UI (demo mode skips it), and failing open here keeps the public
 * demo from ever being locked out by the policy.
 *
 * A per-user `alwaysAllow` grant (stored on the user record, see auth.ts) lets an
 * operator allow someone the domain policy would otherwise block — set it directly in
 * the DB. It only ever grants: `alwaysAllow: false` is not a block, it just defers to
 * the domain policy below.
 *
 * The frontend renders its "not allowed" screen from the `isAllowed` flag computed
 * here and surfaced on the session (see the customSession plugin in auth.ts), rather
 * than re-encoding the domain list client-side. Change the policy here and both the
 * server and the client follow, no frontend rebuild required.
 */

const ALLOWED_EMAIL_DOMAINS = ['@calvin.edu'];
const ALLOWED_EMAILS = ['example-user@textfocals.com'];

export function isUserAllowed(user: {
	email?: string | null;
	isAnonymous?: boolean | null;
	alwaysAllow?: boolean | null;
}): boolean {
	if (user.isAnonymous) return true;
	if (user.alwaysAllow) return true;
	const email = user.email ?? '';
	return (
		ALLOWED_EMAIL_DOMAINS.some((domain) => email.endsWith(domain)) ||
		ALLOWED_EMAILS.includes(email)
	);
}
