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

/**
 * Poke other tabs to re-fetch the user after this tab commits a consent change.
 *
 * `storage` deliberately has no default parameter: a default is evaluated at call
 * time *outside* this function's `try`, and merely touching `localStorage` throws
 * where storage is partitioned or blocked — the Office task-pane iframe, Safari
 * private mode. That throw would escape into the caller, and the caller here is
 * useConsent.save's try block, whose catch rolls the level back and reports
 * failure. The POST has already succeeded at that point, so the user would be told
 * their choice failed (and the onboarding gate would stay up) while the server had
 * recorded it. Resolving storage inside the try keeps this best-effort.
 */
export function broadcastConsentChange(storage?: StorageLike): void {
	try {
		const target = storage ?? localStorage;
		// The value must change each call so the `storage` event actually fires.
		target.setItem(CONSENT_CHANGED_KEY, String(Date.now()));
	} catch {
		// Storage unavailable (partitioned iframe / private mode / quota). Cross-tab
		// sync is an enhancement; this tab already refreshed its own session directly.
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
