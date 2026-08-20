import { mkdtemp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db } from '../db.js';

const env = { ...process.env };
let dataDir: string;

beforeEach(async () => {
	dataDir = await mkdtemp(path.join(tmpdir(), 'wt-db-'));
	process.env.DATA_DIR = dataDir;
});

afterEach(() => {
	closeDb();
	process.env = { ...env };
});

describe('migrations', () => {
	it('creates our schema and records the version', () => {
		const conn = db();
		expect(conn.pragma('user_version', { simple: true })).toBe(7);

		// The table is usable, not merely declared.
		const table = conn
			.prepare(
				`SELECT name FROM sqlite_master WHERE type='table' AND name='llm_usage'`,
			)
			.get();
		expect(table).toBeDefined();

		// v2 added the client_id attribution column...
		const usageCols = (
			conn.prepare(`PRAGMA table_info(llm_usage)`).all() as { name: string }[]
		).map((c) => c.name);
		expect(usageCols).toContain('client_id');

		// ...and v3 added the tool_grant launcher table.
		const grantTable = conn
			.prepare(
				`SELECT name FROM sqlite_master WHERE type='table' AND name='tool_grant'`,
			)
			.get();
		expect(grantTable).toBeDefined();

		// v6 removes the now-unnecessary transient OAuth room selection.
		expect(
			conn.prepare(`SELECT name FROM sqlite_master WHERE name='oauth_room_selection'`).get(),
		).toBeUndefined();
	});

	it('is idempotent across reopens — a second open re-runs nothing', () => {
		db()
			.prepare(
				`INSERT INTO llm_usage (ts, user_id, provider, endpoint, model, status, streamed, duration_ms)
			 VALUES (1, 'usr-1', 'openai', 'chat/completions', 'gpt-4o', 200, 1, 5)`,
			)
			.run();
		closeDb();

		// Reopening must not drop or recreate the table (CREATE TABLE would throw).
		const conn = db();
		expect(conn.pragma('user_version', { simple: true })).toBe(7);
		const rows = conn.prepare(`SELECT COUNT(*) AS n FROM llm_usage`).get() as {
			n: number;
		};
		expect(rows.n).toBe(1);
	});

	it('removes stale dynamic OAuth clients once when upgrading from v6', () => {
		const file = path.join(dataDir, 'app.db');
		const legacy = new Database(file);
		legacy.exec(`
			CREATE TABLE oauthClient (
				id TEXT PRIMARY KEY,
				clientId TEXT NOT NULL UNIQUE
			);
			INSERT INTO oauthClient (id, clientId) VALUES
				('trusted', 'configured-mindmap'),
				('stale', 'old-dynamic-client');
			PRAGMA user_version = 6;
		`);
		legacy.close();
		process.env.MINDMAP_OAUTH_CLIENT_ID = 'configured-mindmap';

		const conn = db();
		expect(conn.pragma('user_version', { simple: true })).toBe(7);
		expect(conn.prepare(`SELECT clientId FROM oauthClient`).all()).toEqual([
			{ clientId: 'configured-mindmap' },
		]);

		// Reopening at v7 must not repeat cleanup or remove a later client.
		conn.prepare(
			`INSERT INTO oauthClient (id, clientId) VALUES ('later', 'later-fixed-client')`,
		).run();
		closeDb();
		expect(db().prepare(`SELECT clientId FROM oauthClient ORDER BY clientId`).all())
			.toEqual([
				{ clientId: 'configured-mindmap' },
				{ clientId: 'later-fixed-client' },
			]);
	});
});

describe('legacy auth.db rename', () => {
	it('adopts an existing auth.db, keeping its rows', () => {
		// Simulate a deployment created before the rename: an auth.db holding users.
		const legacy = new Database(path.join(dataDir, 'auth.db'));
		legacy.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT)`);
		legacy
			.prepare(`INSERT INTO user (id, email) VALUES ('usr-1', 'a@b.c')`)
			.run();
		legacy.close();

		const conn = db();

		// The old file is gone, the new one has the old contents...
		expect(existsSync(path.join(dataDir, 'auth.db'))).toBe(false);
		expect(existsSync(path.join(dataDir, 'app.db'))).toBe(true);
		const user = conn
			.prepare(`SELECT email FROM user WHERE id = 'usr-1'`)
			.get();
		expect(user).toEqual({ email: 'a@b.c' });

		// ...and our migrations then run on top of the adopted database.
		expect(conn.pragma('user_version', { simple: true })).toBe(7);
	});

	it('leaves an existing app.db alone when a stray auth.db is also present', async () => {
		// app.db already exists (the rename happened on a previous boot); a stale
		// auth.db must not clobber it.
		db()
			.prepare(
				`INSERT INTO llm_usage (ts, user_id, provider, endpoint, model, status, streamed, duration_ms)
			 VALUES (1, 'usr-real', 'openai', 'chat/completions', 'gpt-4o', 200, 1, 5)`,
			)
			.run();
		closeDb();
		await writeFile(path.join(dataDir, 'auth.db'), 'stale');

		const rows = db().prepare(`SELECT user_id FROM llm_usage`).all();
		expect(rows).toEqual([{ user_id: 'usr-real' }]);
		expect(existsSync(path.join(dataDir, 'auth.db'))).toBe(true);
	});
});
