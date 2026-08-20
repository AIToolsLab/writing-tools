/**
 * User-data erasure has two deliberately different scopes:
 *
 * - Activity withdrawal (`DELETE /api/me/activity`) removes study logs and the
 *   analytics profile. It preserves active rooms because the user keeps their
 *   account and may have Mindmap open against one of those resources.
 * - Account deletion removes those same records plus durable room document
 *   snapshots. Better Auth then deletes the account and sessions, while the
 *   caller anonymizes content-free usage rows for invoice reconciliation.
 *
 * Keep the two exported operations here so their difference remains explicit.
 */
import { deleteUserLogs } from './logging.js';
import { deletePosthogPerson } from './posthog.js';
import { deleteRoomsForUser } from './rooms.js';

function loggedDataOperations(userId: string): Array<Promise<unknown>> {
	return [deleteUserLogs(userId), deletePosthogPerson(userId)];
}

async function settleErasure(
	label: string,
	operations: Array<Promise<unknown>>,
): Promise<void> {
	const results = await Promise.allSettled(operations);
	const failures = results
		.filter((result): result is PromiseRejectedResult =>
			result.status === 'rejected',
		)
		.map((result) => result.reason);
	if (failures.length > 0) {
		throw new AggregateError(failures, `${label}: partial failure`);
	}
}

/** Remove logged activity without disrupting active room-backed tools. */
export async function eraseLoggedData(userId: string): Promise<void> {
	await settleErasure('eraseLoggedData', loggedDataOperations(userId));
}

/**
 * Remove all person-linked stored content before deleting the account.
 * Keep this as a structural superset of loggedDataOperations: these paths once
 * had separate lists and account deletion accidentally omitted PostHog data.
 */
export async function eraseAccountData(userId: string): Promise<void> {
	await settleErasure('eraseAccountData', [
		...loggedDataOperations(userId),
		deleteRoomsForUser(userId),
	]);
}
