/**
 * What PostHogConsentBridge should do for a given session state. Pure so the
 * consent rules are unit-testable without mounting PostHog.
 *
 * - `capture`: identify the user and opt in. Requires an authenticated session
 *   with a stable id, a level at or above `usage`, a level the user actually
 *   CHOSE (`hasSetConsent` — a fresh user's `usage` is only the default, and the
 *   onboarding gate is still up), and no cross-tab reconcile in flight (its
 *   `none` is provisional, and nothing may be captured until it settles).
 * - otherwise opt out, unconditionally.
 * - `reset`: also drop the PostHog identity. Skipped only while a reconcile is
 *   pending for a still-signed-in user: every cross-tab ping passes through a
 *   provisional `none`, including a consent raise, and resetting on it would
 *   churn a person profile for someone who withdrew nothing. Signing out always
 *   resets.
 */
import { type ConsentLevel, consentRank } from '@/consent';

export interface PostHogConsentInput {
	isAuthenticated: boolean;
	hasSetConsent: boolean;
	consentPending: boolean;
	loggingConsent: ConsentLevel;
	userId: string | undefined;
}

export interface PostHogConsentAction {
	capture: boolean;
	reset: boolean;
}

export function posthogConsentAction(
	input: PostHogConsentInput,
): PostHogConsentAction {
	const capture =
		input.isAuthenticated &&
		input.hasSetConsent &&
		!input.consentPending &&
		!!input.userId &&
		consentRank(input.loggingConsent) >= consentRank('usage');
	if (capture) return { capture, reset: false };
	return {
		capture,
		reset: !input.isAuthenticated || !input.consentPending,
	};
}
