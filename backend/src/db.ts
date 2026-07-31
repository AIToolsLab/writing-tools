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
	// v2 — attribute each metered request to the client that made it (the add-in
	// itself, or an external writing tool launched from the sidebar). Nullable: rows
	// written before this migration, and add-in traffic that doesn't identify itself,
	// stay NULL — read as "the first-party add-in". Tool traffic carries the tool's
	// registered client_id, giving research provenance ("which tool generated this
	// completion") for free. See usage.ts / openaiProxy.ts.
	(conn) => {
		conn.exec(`ALTER TABLE llm_usage ADD COLUMN client_id TEXT;`);
	},
	// v3 — launch grants for the tool launcher (see toolGrants.ts). A sidebar-launched
	// tool never touches Office.js or the user's cookies; the taskpane mints a
	// single-use, short-TTL grant that the tool exchanges (on its own foreign origin)
	// for a bearer token scoped to that tool, plus an optional read-only document
	// snapshot. The row is the persistent record; the access token authenticates the
	// tool's later calls to the LLM proxy and log endpoints. No foreign key to `user`:
	// the token outlives nothing important, but a cascade is needless coupling and the
	// grant is validated against a live session at creation time regardless.
	(conn) => {
		conn.exec(`
			CREATE TABLE tool_grant (
				grant_id TEXT PRIMARY KEY,
				-- Bearer token handed back on exchange (prefixed 'wtk_'); NULL until then.
				access_token TEXT UNIQUE,
				-- The full authenticated identity captured at creation time (JSON of the
				-- SessionUser minus client_id), so exchange/proxy never depend on the
				-- auth user table still holding the row.
				user_snapshot TEXT NOT NULL,
				-- The tool this grant authorizes — a registered device/tool client_id.
				tool_client_id TEXT NOT NULL,
				-- JSON array of granted scopes (openai:chat, log:write, doc:read, …).
				scopes TEXT NOT NULL,
				-- JSON DocContext snapshot handed to the tool, or NULL when none was shared.
				doc_snapshot TEXT,
				created_at INTEGER NOT NULL,
				-- Grant TTL: the window in which the grant_id may be exchanged (~2 min).
				expires_at INTEGER NOT NULL,
				-- Single-use marker: set to the exchange time; a second exchange is refused.
				exchanged_at INTEGER,
				-- Access-token validity, set at exchange time.
				token_expires_at INTEGER,
				-- Disconnect: set when the token is revoked (tool or user teardown).
				revoked_at INTEGER
			);
			CREATE INDEX tool_grant_user ON tool_grant (json_extract(user_snapshot, '$.id'));
		`);
	},
	// v4 — durable document rooms plus the short-lived room choice made during an
	// OAuth authorization. OAuth Provider stores the chosen room id as referenceId
	// on the consent, authorization code and access token; these tables hold the
	// application resource and the server-side selection that feeds that hook.
	(conn) => {
		conn.exec(`
			CREATE TABLE room (
				id TEXT PRIMARY KEY,
				owner_user_id TEXT NOT NULL,
				name TEXT NOT NULL,
				doc_snapshot TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE INDEX room_owner_updated ON room (owner_user_id, updated_at DESC);

			CREATE TABLE oauth_room_selection (
				session_id TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				room_id TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				FOREIGN KEY (room_id) REFERENCES room(id) ON DELETE CASCADE
			);
			CREATE INDEX oauth_room_selection_expiry ON oauth_room_selection (expires_at);
		`);
	},
	// v5 — key the transient room choice to one OAuth authorization request, not
	// merely to the browser session. A user can authorize in multiple tabs; one
	// tab must never supply or overwrite the room for another tab's grant.
	(conn) => {
		conn.exec(`
			DROP TABLE oauth_room_selection;
			CREATE TABLE oauth_room_selection (
				session_id TEXT NOT NULL,
				authorization_state TEXT NOT NULL,
				user_id TEXT NOT NULL,
				room_id TEXT NOT NULL,
				expires_at INTEGER NOT NULL,
				PRIMARY KEY (session_id, authorization_state),
				FOREIGN KEY (room_id) REFERENCES room(id) ON DELETE CASCADE
			);
			CREATE INDEX oauth_room_selection_expiry ON oauth_room_selection (expires_at);
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
