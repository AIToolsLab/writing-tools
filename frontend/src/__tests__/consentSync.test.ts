import { describe, expect, it, vi } from 'vitest';
import {
	CONSENT_CHANGED_KEY,
	broadcastConsentChange,
	onConsentChangeFromOtherTab,
} from '../consentSync';

// The cross-tab consent sync is the fix for the leak where a consent change on the
// standalone account page (a separate tab) never reached the still-open app tab, so
// that tab kept logging at the pre-change level. These cover the wiring both ends
// depend on: a save broadcasts, and another tab's listener refreshes only for our key.
describe('consentSync', () => {
	it('broadcast writes the change key so other tabs get a storage event', () => {
		const setItem = vi.fn();
		broadcastConsentChange({ setItem });
		expect(setItem).toHaveBeenCalledWith(
			CONSENT_CHANGED_KEY,
			expect.any(String),
		);
	});

	it('fires the handler only for the consent key, and stops after unsubscribe', () => {
		const target = new EventTarget();
		const handler = vi.fn();
		const unsubscribe = onConsentChangeFromOtherTab(handler, target);

		// An unrelated storage change (some other key) must not trigger a refresh.
		const other = new Event('storage') as Event & { key: string };
		other.key = 'unrelated-key';
		target.dispatchEvent(other);
		expect(handler).not.toHaveBeenCalled();

		// A consent broadcast triggers exactly one refresh.
		const consent = new Event('storage') as Event & { key: string };
		consent.key = CONSENT_CHANGED_KEY;
		target.dispatchEvent(consent);
		expect(handler).toHaveBeenCalledTimes(1);

		// After unsubscribing, no further refreshes.
		unsubscribe();
		target.dispatchEvent(consent);
		expect(handler).toHaveBeenCalledTimes(1);
	});
});
