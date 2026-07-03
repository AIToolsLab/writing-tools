import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { betterAuth } from 'better-auth';
import { bearer, deviceAuthorization } from 'better-auth/plugins';
import Database from 'better-sqlite3';
import {
	betterAuthSecret,
	betterAuthTrustedOrigins,
	betterAuthUrl,
	dataDir,
	deviceClientIds,
	googleClientId,
	googleClientSecret,
} from './config.js';

// The auth DB lives under the shared DATA_DIR (defaults to backend/data). In
// Docker/k8s, DATA_DIR points at the mounted volume so auth.db persists.
const dbPath = path.join(dataDir(), 'auth.db');

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
	plugins: [
		bearer(),
		deviceAuthorization({
			verificationUri: '/api/device', // nginx forwards /api/* to Hono
			// Short expiry shrinks the brute-force window for the manually-entered
			// user code (default length 8). No per-code attempt lockout yet.
			expiresIn: '4m',
			interval: '5s',
			schema: {}, // workaround for https://github.com/better-auth/better-auth/issues/9422
			validateClient: (clientId) => deviceClientIds().includes(clientId),
		}),
	],
	socialProviders: {
		google: {
			clientId: googleClientId(),
			clientSecret: googleClientSecret(),
			// Always show Google's account chooser so the user consciously picks which
			// account authorizes the device (avoids silently reusing a wrong session).
			prompt: 'select_account',
		},
	},
});

export type Auth = typeof auth;
