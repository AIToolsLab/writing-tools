import { describe, expect, it } from 'vitest';
import { analyticsAllowed } from '@/consent';

describe('analyticsAllowed', () => {
	it('waits while a new user has only the default level', () => {
		expect(
			analyticsAllowed({
				isAuthenticated: true,
				hasSetConsent: false,
				loggingConsent: 'usage',
			}),
		).toBe(false);
	});

	it('allows capture once the user has chosen usage or above', () => {
		expect(
			analyticsAllowed({
				isAuthenticated: true,
				hasSetConsent: true,
				loggingConsent: 'usage',
			}),
		).toBe(true);
	});

	it('never captures at none, or when signed out', () => {
		expect(
			analyticsAllowed({
				isAuthenticated: true,
				hasSetConsent: true,
				loggingConsent: 'none',
			}),
		).toBe(false);
		expect(
			analyticsAllowed({
				isAuthenticated: false,
				hasSetConsent: true,
				loggingConsent: 'document',
			}),
		).toBe(false);
	});
});
