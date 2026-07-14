/**
 * The application database — one SQLite file, one connection, shared by Better
 * Auth and by our own tables.
 *
 * Better Auth manages its own schema (it introspects and creates its tables via
 * `@better-auth/cli migrate` / src/migrate.ts). Everything else — currently just
 * `llm_usage`, and any user preferences we add later — is versioned here with
 * `PRAGMA user_version`, which Better Auth doesn't touch. Migrations are plain
 * SQL steps applied in order, each bumping the version inside a transaction, so a
 * half-applied migration can't leave the schema mid-flight.
 *
 * Adding a schema change: append a step to MIGRATIONS. Never edit an existing
 * step — deployed databases have already run it and will skip it forever.
 */
import { mkdirSync, renameSync, existsSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { dataDir } from './config.js';

function dbPath(): string {
	return path.join(dataDir(), 'app.db');
}

/**
 * The DB used to be called auth.db, back when Better Auth was its only tenant.
 * Rename it in place on first startup so existing deployments keep their users.
 * The -wal/-shm siblings are renamed with it: SQLite locates them by the main
 * file's name, so they have to move together or a pending WAL would be orphaned.
 */
function renameLegacyAuthDb(target: string): void {
	const legacy = path.join(dataDir(), 'auth.db');
	if (existsSync(target) || !existsSync(legacy)) return;

	for (const suffix of ['', '-wal', '-shm']) {
		if (existsSync(legacy + suffix)) {
			renameSync(legacy + suffix, target + suffix);
		}
	}
	console.log(`Renamed legacy auth.db → ${path.basename(target)}.`);
}

/**
 * Ordered schema steps for our (non-Better-Auth) tables. The array index is the
 * version: after running MIGRATIONS[0], user_version is 1.
 */
const MIGRATIONS: Array<(conn: Database.Database) => void> = [
	// v1 — LLM usage metering (see usage.ts). No foreign key to `user`: a cascade
	// would delete the billing rows we deliberately keep when an account is
	// deleted (they're anonymized instead).
	(conn) => {
		conn.exec(`
			CREATE TABLE llm_usage (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				ts INTEGER NOT NULL,
				user_id TEXT NOT NULL,
				provider TEXT NOT NULL,
				endpoint TEXT NOT NULL,
				model TEXT NOT NULL,
				input_tokens INTEGER NOT NULL DEFAULT 0,
				cached_input_tokens INTEGER NOT NULL DEFAULT 0,
				output_tokens INTEGER NOT NULL DEFAULT 0,
				reasoning_tokens INTEGER NOT NULL DEFAULT 0,
				status INTEGER NOT NULL,
				streamed INTEGER NOT NULL,
				-- request sent → last byte of the upstream response (the whole
				-- generation, for a stream). ttft_ms is request sent → first byte,
				-- i.e. what the user actually waits for; NULL when not streaming,
				-- where there is no first token to distinguish from the last.
				duration_ms INTEGER NOT NULL,
				ttft_ms INTEGER
			);
			CREATE INDEX llm_usage_user_ts ON llm_usage (user_id, ts);
		`);
	},
];

function migrate(conn: Database.Database): void {
	const current = conn.pragma('user_version', { simple: true }) as number;
	for (let version = current; version < MIGRATIONS.length; version++) {
		const step = MIGRATIONS[version];
		if (!step) continue;
		conn.transaction(() => {
			step(conn);
			conn.pragma(`user_version = ${version + 1}`);
		})();
	}
}

// Cached per resolved path so tests can repoint DATA_DIR at a temp dir and get a
// fresh database rather than the previous test's connection.
const connections = new Map<string, Database.Database>();

/** The shared connection, opened and migrated on first use. */
export function db(): Database.Database {
	const file = dbPath();
	const existing = connections.get(file);
	if (existing) return existing;

	mkdirSync(path.dirname(file), { recursive: true });
	renameLegacyAuthDb(file);

	const conn = new Database(file);
	conn.pragma('journal_mode = WAL');
	conn.pragma('foreign_keys = ON');
	migrate(conn);

	connections.set(file, conn);
	return conn;
}

/** Close the cached connections. Tests call this between temp DATA_DIRs. */
export function closeDb(): void {
	for (const conn of connections.values()) conn.close();
	connections.clear();
}
