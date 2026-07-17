import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../db.js';
import { costUsd } from '../pricing.js';
import {
	anonymizeUserUsage,
	DELETED_USER_ID,
	recordUsage,
	summarizeUsage,
	type UsageRecord,
} from '../usage.js';

const env = { ...process.env };

beforeEach(async () => {
	// Point the shared DB at a fresh temp dir; db.ts derives it from DATA_DIR.
	process.env.DATA_DIR = await mkdtemp(path.join(tmpdir(), 'wt-usage-'));
});

afterEach(() => {
	closeDb();
	process.env = { ...env };
});

function record(overrides: Partial<UsageRecord> = {}): void {
	recordUsage({
		userId: 'usr-1',
		provider: 'openai',
		endpoint: 'chat/completions',
		model: 'gpt-4o',
		inputTokens: 1000,
		cachedInputTokens: 0,
		outputTokens: 100,
		reasoningTokens: 0,
		status: 200,
		streamed: true,
		durationMs: 500,
		ttftMs: 120,
		...overrides,
	});
}

const ALL_TIME = (): [number, number] => [0, Date.now() + 1000];

describe('recordUsage / summarizeUsage', () => {
	it('groups token totals by user and model', () => {
		record({ userId: 'usr-1' });
		record({ userId: 'usr-1' });
		record({ userId: 'usr-2', model: 'gpt-4o-mini', outputTokens: 50 });

		const rows = summarizeUsage(...ALL_TIME());
		expect(rows).toHaveLength(2);

		const first = rows.find((r) => r.userId === 'usr-1');
		expect(first?.requests).toBe(2);
		expect(first?.inputTokens).toBe(2000);
		expect(first?.outputTokens).toBe(200);

		const second = rows.find((r) => r.userId === 'usr-2');
		expect(second?.model).toBe('gpt-4o-mini');
		expect(second?.requests).toBe(1);
	});

	it('excludes rows outside the window', () => {
		record();
		expect(summarizeUsage(0, Date.now() - 60_000)).toEqual([]);
	});

	it('leaves email null when Better Auth has never created the user table', () => {
		record();
		expect(summarizeUsage(...ALL_TIME())[0]).toMatchObject({ email: null });
	});

	it("labels rows with the account's email — the point of sharing one DB", () => {
		// Stand in for Better Auth's `user` table, which lives in the same database.
		db().exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT)`);
		db()
			.prepare(
				`INSERT INTO user (id, email) VALUES ('usr-1', 'ken@example.edu')`,
			)
			.run();
		record({ userId: 'usr-1' });

		expect(summarizeUsage(...ALL_TIME())[0]).toMatchObject({
			userId: 'usr-1',
			email: 'ken@example.edu',
		});
	});

	it('shows the deleted bucket as unlabelled, since no account matches it', () => {
		db().exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT)`);
		record({ userId: 'usr-gone' });
		anonymizeUserUsage('usr-gone');

		expect(summarizeUsage(...ALL_TIME())[0]).toMatchObject({
			userId: DELETED_USER_ID,
			email: null,
		});
	});
});

describe('anonymizeUserUsage', () => {
	it("moves a deleted account's rows to the shared bucket, keeping the tokens", () => {
		record({ userId: 'usr-gone', inputTokens: 500, outputTokens: 25 });
		record({ userId: 'usr-stays' });

		anonymizeUserUsage('usr-gone');

		const rows = summarizeUsage(...ALL_TIME());
		expect(rows.map((r) => r.userId).sort()).toEqual([
			DELETED_USER_ID,
			'usr-stays',
		]);

		// The spend survives the deletion — that's the whole point of the tombstone.
		const tombstoned = rows.find((r) => r.userId === DELETED_USER_ID);
		expect(tombstoned?.inputTokens).toBe(500);
		expect(tombstoned?.outputTokens).toBe(25);
	});

	it('merges every deleted user into one bucket rather than a per-user pseudonym', () => {
		record({ userId: 'usr-a' });
		record({ userId: 'usr-b' });
		anonymizeUserUsage('usr-a');
		anonymizeUserUsage('usr-b');

		const rows = summarizeUsage(...ALL_TIME());
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ userId: DELETED_USER_ID, requests: 2 });
	});
});

describe('costUsd', () => {
	it('prices input and output at the model rate', () => {
		// gpt-4o: $2.50/1M input, $10.00/1M output.
		const cost = costUsd({
			model: 'gpt-4o',
			inputTokens: 1_000_000,
			cachedInputTokens: 0,
			outputTokens: 1_000_000,
		});
		expect(cost).toBeCloseTo(12.5, 6);
	});

	it('discounts the cached portion of the input rather than adding to it', () => {
		// 1M input of which 1M is cached => all of it bills at the $1.25 cached rate.
		const cost = costUsd({
			model: 'gpt-4o',
			inputTokens: 1_000_000,
			cachedInputTokens: 1_000_000,
			outputTokens: 0,
		});
		expect(cost).toBeCloseTo(1.25, 6);
	});

	it('resolves dated snapshots to the base model, preferring the longest match', () => {
		const mini = costUsd({
			model: 'gpt-4o-mini-2024-07-18',
			inputTokens: 1_000_000,
			cachedInputTokens: 0,
			outputTokens: 0,
		});
		// $0.15/1M for gpt-4o-mini, not $2.50 for gpt-4o.
		expect(mini).toBeCloseTo(0.15, 6);
	});

	it('returns null for an unpriced model instead of silently costing zero', () => {
		expect(
			costUsd({
				model: 'some-future-model',
				inputTokens: 1_000_000,
				cachedInputTokens: 0,
				outputTokens: 1_000_000,
			}),
		).toBeNull();
	});
});
