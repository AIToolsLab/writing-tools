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

const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
console.log('Better Auth migrations applied.');
process.exit(0);
