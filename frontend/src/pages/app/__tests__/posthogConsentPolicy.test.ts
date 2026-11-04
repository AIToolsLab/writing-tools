import { describe, expect, it } from 'vitest';
import {
	type PostHogConsentInput,
	posthogConsentAction,
} from '../posthogConsentPolicy';

const CHOSEN_USAGE: PostHogConsentInput = {
	isAuthenticated: true,
	hasSetConsent: true,
	consentPending: false,
	loggingConsent: 'usage',
	userId: 'u1',
};

describe('posthogConsentAction', () => {
	it('captures for a signed-in user who chose usage or above', () => {
		expect(posthogConsentAction(CHOSEN_USAGE)).toEqual({
			capture: true,
			reset: false,
		});
		expect(
			posthogConsentAction({
				...CHOSEN_USAGE,
				loggingConsent: 'document',
			}).capture,
		).toBe(true);
	});

	// Regression (Codex HOLD #1): a fresh user's `usage` is only the default; the
	// onboarding gate is still up, so nothing may be captured yet.
	it('does not capture before the user has chosen a level', () => {
		expect(
			posthogConsentAction({ ...CHOSEN_USAGE, hasSetConsent: false })
				.capture,
		).toBe(false);
	});

	it('does not capture while a cross-tab reconcile is pending', () => {
		expect(
			posthogConsentAction({
				...CHOSEN_USAGE,
				consentPending: true,
				loggingConsent: 'document',
			}),
		).toEqual({ capture: false, reset: false });
	});

	it('does not capture at none, and resets identity once settled', () => {
		expect(
			posthogConsentAction({ ...CHOSEN_USAGE, loggingConsent: 'none' }),
		).toEqual({ capture: false, reset: true });
	});

	it('does not capture without a stable user id', () => {
		expect(
			posthogConsentAction({ ...CHOSEN_USAGE, userId: undefined })
				.capture,
		).toBe(false);
	});

	it('always resets on sign-out, even if a reconcile was pending', () => {
		expect(
			posthogConsentAction({
				...CHOSEN_USAGE,
				isAuthenticated: false,
				consentPending: true,
			}),
		).toEqual({ capture: false, reset: true });
	});
});
