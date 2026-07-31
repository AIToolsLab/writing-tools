// Standalone schema migration entrypoint.
//
// Migrates the shared application database (`app.db` under DATA_DIR): Better
// Auth's tables (core plus plugin tables, e.g. the device-authorization
// `deviceCode` table) and our own (db.ts's `user_version` steps). Deployments run
// this before starting the server — e.g. as a Kubernetes initContainer sharing the
// DATA_DIR volume — so a fresh volume is migrated without needing @better-auth/cli
// or dev dependencies in the runtime image. Idempotent: only missing migrations
// are applied.
//
// Importing auth.js opens the shared connection, which applies our migrations (and
// renames a legacy auth.db) as a side effect; getMigrations then applies Better
// Auth's on the same connection. The explicit db() call below just makes that
// ordering visible rather than incidental.
import { getMigrations } from 'better-auth/db/migration';
import { auth } from './auth.js';
import { db } from './db.js';
import { provisionTrustedMindmapClient } from './oauth-clients.js';

// Let the process exit naturally rather than calling process.exit(): in a
// container stdout is a pipe (async on Unix), so exiting immediately after a
// log can truncate it. better-sqlite3 is synchronous and holds nothing open on
// the event loop, so the process ends on its own once this resolves. On failure
// we set a non-zero exit code so the initContainer fails and blocks the pod.
try {
	db();
	console.log('Application schema migrations applied.');

	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
	console.log('Better Auth migrations applied.');
	await provisionTrustedMindmapClient(auth);
	console.log('Trusted Mindmap OAuth client provisioned.');
} catch (err) {
	console.error('Migration failed:', err);
	process.exitCode = 1;
}
