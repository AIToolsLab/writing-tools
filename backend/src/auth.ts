import { betterAuth } from 'better-auth';
import { bearer, deviceAuthorization } from 'better-auth/plugins';
import {
	betterAuthSecret,
	betterAuthTrustedOrigins,
	betterAuthUrl,
	deviceClientIds,
	googleClientId,
	googleClientSecret,
} from './config.js';
import { db } from './db.js';
import { deleteUserLogs } from './logging.js';
import { anonymizeUserUsage } from './usage.js';

// A module-level `auth` singleton (not a factory) so the Better Auth CLI can
// auto-discover it: `npx @better-auth/cli migrate` looks for an exported `auth`
// instance in src/auth.ts. app.ts imports the TYPE only, so importing app.ts in
// tests never executes this module and never opens SQLite. index.ts imports this
// module dynamically, and only when BETTER_AUTH_ENABLED=true.
export const auth = betterAuth({
	// The shared application database (db.ts) — Better Auth's tables and ours live
	// in one file, on one connection. Better Auth creates its own tables here via
	// `@better-auth/cli migrate` (src/migrate.ts); ours are versioned in db.ts.
	database: db(),
	baseURL: betterAuthUrl(),
	secret: betterAuthSecret(),
	trustedOrigins: betterAuthTrustedOrigins(),
	// Logging-consent level lives on the user record so it's available on every
	// session. Server-controlled (`input: false`): set only via auth.api.updateUser
	// from our /api/me/consent route, never accepted from sign-up input. The enum
	// mirrors CONSENT_LEVELS in consent.ts. New users default to 'usage'
	// (content-free); content logging (ai_output/document) requires opting up.
	user: {
		additionalFields: {
			loggingConsent: {
				type: ['none', 'usage', 'ai_output', 'document'],
				defaultValue: 'usage',
				required: false,
				input: false,
			},
			consentUpdatedAt: {
				type: 'date',
				required: false,
				input: false,
			},
		},
		// Enables auth.api.deleteUser for the authenticated user (off by default).
		// beforeDelete purges the user's study logs so "delete my account" also
		// removes their data. Google-only accounts have no password, so deletion
		// proceeds from the session alone (no verification flow configured).
		//
		// LLM usage rows are anonymized rather than deleted: they're content-free
		// billing records, and dropping them would make our per-user spend stop
		// reconciling with the provider's invoice. See usage.ts.
		deleteUser: {
			enabled: true,
			beforeDelete: async (user) => {
				await deleteUserLogs(user.id);
				anonymizeUserUsage(user.id);
			},
		},
	},
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
