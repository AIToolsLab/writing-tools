/**
 * Erasing a user's logged activity — the one definition of what "delete my data"
 * means, shared by both paths that promise it.
 *
 * Two different requests reach this:
 *   - "delete my logged activity" (DELETE /api/me/activity) — withdrawal. The user
 *     keeps their account and keeps using the add-in; they just want what we've
 *     recorded about them gone. Their LLM usage rows stay: the account is still
 *     open and still running up a bill, so it still has to be metered.
 *   - "delete my account" (Better Auth's deleteUser) — departure. The `beforeDelete`
 *     hook calls this too, and *then* anonymizes the usage rows and drops the
 *     account, so account deletion is by construction a superset of the above.
 *
 * Keeping this in one function is the point: when the two paths each maintained
 * their own list, account deletion quietly forgot to purge the PostHog person —
 * the thorough option was doing less than the lesser one.
 */
import { deleteUserLogs } from './logging.js';
import { deletePosthogPerson } from './posthog.js';

/**
 * Delete everything we've logged about a user: their study-log file and their
 * analytics profile. PostHog deletion is best-effort (it needs a management API
 * key; see deletePosthogPerson) and never throws. The two touch unrelated systems,
 * so we run them concurrently and independently — a failure deleting the log file
 * must not skip the PostHog deletion, or vice versa. If either genuinely fails we
 * still surface it, so the caller (e.g. Better Auth's beforeDelete) can abort rather
 * than drop an account whose data we couldn't erase.
 */
export async function eraseLoggedData(userId: string): Promise<void> {
	const results = await Promise.allSettled([
		deleteUserLogs(userId),
		deletePosthogPerson(userId),
	]);
	const failures = results
		.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
		.map((r) => r.reason);
	if (failures.length > 0) {
		throw new AggregateError(failures, 'eraseLoggedData: partial failure');
	}
}
