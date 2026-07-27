/**
 * Cross-tab consent propagation.
 *
 * The account & privacy page opens in a separate browsing context (a new tab), so a
 * consent change made there refreshes only *that* tab's session. Without this, the
 * still-open app tab keeps its stale `loggingConsent`: its PostHog bridge stays
 * opted in and `useLog` keeps stripping at the old, higher level after the user has
 * lowered (or withdrawn) consent. On a successful save we bump a localStorage key;
 * other same-origin tabs receive the `storage` event — which fires only in tabs
 * *other* than the writer, exactly the stale ones — and refresh their session.
 *
 * The storage/event-target dependencies are injectable so the wiring is testable in
 * a node environment without a DOM; callers use the `window`/`localStorage` defaults.
 */
export const CONSENT_CHANGED_KEY = 'consent:changed';

type StorageLike = Pick<Storage, 'setItem'>;
type EventTargetLike = Pick<
	EventTarget,
	'addEventListener' | 'removeEventListener'
>;

/** Poke other tabs to re-fetch the user after this tab commits a consent change. */
export function broadcastConsentChange(
	storage: StorageLike = localStorage,
): void {
	try {
		// The value must change each call so the `storage` event actually fires.
		storage.setItem(CONSENT_CHANGED_KEY, String(Date.now()));
	} catch {
		// localStorage unavailable (private mode / quota). Cross-tab sync is a
		// best-effort enhancement; the writing tab already refreshed directly.
	}
}

/**
 * Subscribe to consent changes broadcast by other tabs. Returns an unsubscribe fn.
 */
export function onConsentChangeFromOtherTab(
	handler: () => void,
	target: EventTargetLike = window,
): () => void {
	const listener = (event: Event) => {
		if ((event as StorageEvent).key === CONSENT_CHANGED_KEY) handler();
	};
	target.addEventListener('storage', listener);
	return () => target.removeEventListener('storage', listener);
}
