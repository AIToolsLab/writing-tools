// Standalone Better Auth schema migration entrypoint.
//
// Runs the SQLite migrations for the configured auth instance (core tables plus
// any plugin tables, e.g. the device-authorization `deviceCode` table) and
// exits. Deployments run this before starting the server — e.g. as a Kubernetes
// initContainer sharing the DATA_DIR volume — so `auth.db` is migrated on a
// fresh volume without needing @better-auth/cli or dev dependencies in the
// runtime image. Idempotent: only missing migrations are applied.
import { getMigrations } from 'better-auth/db/migration';
import { auth } from './auth.js';

// Let the process exit naturally rather than calling process.exit(): in a
// container stdout is a pipe (async on Unix), so exiting immediately after a
// log can truncate it. better-sqlite3 is synchronous and holds nothing open on
// the event loop, so the process ends on its own once this resolves. On failure
// we set a non-zero exit code so the initContainer fails and blocks the pod.
try {
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
	console.log('Better Auth migrations applied.');
} catch (err) {
	console.error('Better Auth migration failed:', err);
	process.exitCode = 1;
}
