import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb } from '../db.js';
import { eraseLoggedData } from '../erasure.js';
import { appendLog } from '../logging.js';
import { deletePosthogPerson } from '../posthog.js';
import {
	DELETED_USER_ID,
	recordUsage,
	summarizeUsage,
	type UsageRecord,
} from '../usage.js';

// PostHog deletion is a network call to their management API; we only care that
// the erasure paths ask for it.
vi.mock('../posthog.js', () => ({
	deletePosthogPerson: vi.fn(async () => {}),
	captureException: vi.fn(async () => {}),
}));

const env = { ...process.env };

beforeEach(async () => {
	const dir = await mkdtemp(path.join(tmpdir(), 'wt-erase-'));
	process.env.DATA_DIR = dir;
	process.env.LOG_DIR = path.join(dir, 'logs');
	vi.mocked(deletePosthogPerson).mockClear();
});

afterEach(() => {
	closeDb();
	process.env = { ...env };
});

async function logSomething(userId: string) {
	await appendLog({
		timestamp: 1,
		ok: true,
		username: userId,
		event: 'saved',
		extra_data: {},
	});
}

function meterSomething(userId: string) {
	recordUsage({
		userId,
		provider: 'openai',
		endpoint: 'chat/completions',
		model: 'gpt-4o',
		inputTokens: 100,
		cachedInputTokens: 0,
		outputTokens: 10,
		reasoningTokens: 0,
		status: 200,
		streamed: true,
		durationMs: 300,
		ttftMs: 90,
	} satisfies UsageRecord);
}

function logExists(userId: string): boolean {
	return existsSync(
		path.join(process.env.LOG_DIR as string, `${userId}.jsonl`),
	);
}

describe('eraseLoggedData', () => {
	it('removes the study log and the analytics profile together', async () => {
		await logSomething('usr-1');
		expect(logExists('usr-1')).toBe(true);

		await eraseLoggedData('usr-1');

		expect(logExists('usr-1')).toBe(false);
		expect(deletePosthogPerson).toHaveBeenCalledWith('usr-1');
	});
});

describe('account deletion (Better Auth beforeDelete)', () => {
	it('does everything withdrawal does, and anonymizes the usage rows on top', async () => {
		// Imported here, not at module load: auth.ts opens the DB as a side effect of
		// evaluation, so it has to see this test's temp DATA_DIR.
		process.env.BETTER_AUTH_SECRET = 'x'.repeat(32);
		process.env.BETTER_AUTH_URL = 'http://localhost:8000';
		process.env.GOOGLE_CLIENT_ID = 'test';
		process.env.GOOGLE_CLIENT_SECRET = 'test';
		const { auth } = await import('../auth.js');

		await logSomething('usr-gone');
		meterSomething('usr-gone');

		const beforeDelete = auth.options.user?.deleteUser?.beforeDelete;
		expect(beforeDelete).toBeDefined();
		// Better Auth hands the hook the full user record; only the id is read.
		await beforeDelete?.({ id: 'usr-gone' } as never);

		// The withdrawal erasure — this is the half account deletion used to skip.
		expect(logExists('usr-gone')).toBe(false);
		expect(deletePosthogPerson).toHaveBeenCalledWith('usr-gone');

		// ...plus the tombstone: the spend survives, detached from the person.
		const rows = summarizeUsage(0, Date.now() + 1000);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			userId: DELETED_USER_ID,
			inputTokens: 100,
			outputTokens: 10,
		});
	});
});
