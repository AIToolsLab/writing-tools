import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { betterAuth } from 'better-auth';
import { bearer } from 'better-auth/plugins';
import Database from 'better-sqlite3';
import {
	betterAuthSecret,
	betterAuthTrustedOrigins,
	betterAuthUrl,
	googleClientId,
	googleClientSecret,
} from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DB path resolves to backend/data/auth.db from both src/ (dev) and dist/ (built).
// Docker mounts target /app/backend/data. Path is intentionally fixed for this milestone.
const dbPath = path.resolve(__dirname, '../data/auth.db');

// Ensure the data directory exists. This runs only when this module is actually
// executed — i.e. at runtime when auth is enabled, or when the Better Auth CLI
// imports this file for migration. mkdirSync creates the directory; new Database()
// creates auth.db if absent; `@better-auth/cli migrate` creates the tables.
mkdirSync(path.dirname(dbPath), { recursive: true });

// A module-level `auth` singleton (not a factory) so the Better Auth CLI can
// auto-discover it: `npx @better-auth/cli migrate` looks for an exported `auth`
// instance in src/auth.ts. app.ts imports the TYPE only, so importing app.ts in
// tests never executes this module and never opens SQLite. index.ts imports this
// module dynamically, and only when BETTER_AUTH_ENABLED=true.
export const auth = betterAuth({
	database: new Database(dbPath),
	baseURL: betterAuthUrl(),
	secret: betterAuthSecret(),
	trustedOrigins: betterAuthTrustedOrigins(),
	plugins: [bearer()],
	socialProviders: {
		google: {
			clientId: googleClientId(),
			clientSecret: googleClientSecret(),
		},
	},
});

export type Auth = typeof auth;
