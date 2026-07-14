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
 * key; see deletePosthogPerson), so a failure there is reported rather than
 * thrown — the logs we control are still gone.
 */
export async function eraseLoggedData(userId: string): Promise<void> {
	await deleteUserLogs(userId);
	await deletePosthogPerson(userId);
}
