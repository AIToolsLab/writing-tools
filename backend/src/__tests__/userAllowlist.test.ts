import { describe, expect, it } from 'vitest';
import { isUserAllowed } from '../userAllowlist.js';

describe('isUserAllowed', () => {
	it('allows Calvin email addresses', () => {
		expect(isUserAllowed({ email: 'someone@calvin.edu' })).toBe(true);
	});

	it('allows the example test user', () => {
		expect(isUserAllowed({ email: 'example-user@textfocals.com' })).toBe(true);
	});

	it('blocks other email addresses', () => {
		expect(isUserAllowed({ email: 'someone@gmail.com' })).toBe(false);
	});

	it('blocks a missing email', () => {
		expect(isUserAllowed({})).toBe(false);
		expect(isUserAllowed({ email: null })).toBe(false);
	});

	it('does not treat the domain as a substring match', () => {
		expect(isUserAllowed({ email: 'calvin.edu@evil.com' })).toBe(false);
	});

	it('always allows anonymous (demo) sessions', () => {
		expect(isUserAllowed({ isAnonymous: true })).toBe(true);
		expect(isUserAllowed({ email: 'someone@gmail.com', isAnonymous: true })).toBe(
			true,
		);
	});

	it('honors the per-user alwaysAllow grant for an otherwise-blocked user', () => {
		expect(
			isUserAllowed({ email: 'someone@gmail.com', alwaysAllow: true }),
		).toBe(true);
	});

	it('alwaysAllow false is not a block — the domain policy stays in charge', () => {
		expect(
			isUserAllowed({ email: 'someone@gmail.com', alwaysAllow: false }),
		).toBe(false);
	});
});
