import { betterAuth } from 'better-auth';
import { anonymous, bearer, deviceAuthorization } from 'better-auth/plugins';
import {
	betterAuthSecret,
	betterAuthTrustedOrigins,
	betterAuthUrl,
	deviceClientIds,
	googleClientId,
	googleClientSecret,
} from './config.js';
import {
	type ConsentLevel,
	CONSENT_LEVELS,
	DEFAULT_CONSENT_LEVEL,
	FULL_CONSENT_LEVEL,
} from './consent.js';
import { db } from './db.js';
import { eraseLoggedData } from './erasure.js';
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
	// Anonymous (demo) users are created at full logging consent — the public demo
	// discloses that all usage is logged, so there's nothing to opt up to. Real
	// accounts fall through untouched and keep the content-free default ('usage'),
	// raising it themselves via /api/me/consent. loggingConsent is `input: false`,
	// so it can't come from sign-up input; this server-side create hook is the only
	// path that writes it at 'full'.
	databaseHooks: {
		user: {
			create: {
				before: async (user) => {
					if (!(user as { isAnonymous?: boolean }).isAnonymous) return;
					return {
						data: {
							...user,
							loggingConsent: FULL_CONSENT_LEVEL,
							consentUpdatedAt: new Date(),
						},
					};
				},
			},
		},
	},
	baseURL: betterAuthUrl(),
	secret: betterAuthSecret(),
	trustedOrigins: betterAuthTrustedOrigins(),
	// Logging-consent level lives on the user record so it's available on every
	// session. Server-controlled (`input: false`): set only via auth.api.updateUser
	// from our /api/me/consent route, never accepted from sign-up input. The enum and
	// default come straight from consent.ts (the single source of truth). New users
	// default to 'usage' (content-free); content logging requires opting up.
	user: {
		additionalFields: {
			loggingConsent: {
				type: [...CONSENT_LEVELS],
				defaultValue: DEFAULT_CONSENT_LEVEL,
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
		// Google-only accounts have no password, so deletion proceeds from the
		// session alone (no verification flow configured).
		//
		// beforeDelete runs the same erasure as the withdrawal endpoint (study logs
		// + analytics profile), so account deletion is by construction a superset of
		// it — see erasure.ts. On top of that it anonymizes the LLM usage rows rather
		// than deleting them: they're content-free billing records, and dropping them
		// would make our per-user spend stop reconciling with the provider's invoice
		// (see usage.ts). Better Auth then drops the account, sessions and OAuth links.
		deleteUser: {
			enabled: true,
			beforeDelete: async (user) => {
				await eraseLoggedData(user.id);
				anonymizeUserUsage(user.id);
			},
		},
	},
	plugins: [
		bearer(),
		// Demo mode. signIn.anonymous() mints a real user + session, so the whole
		// identity-keyed stack (resolveUser, /api/log, consent gating, usage
		// metering) works for demo users with no special-casing — they're just a
		// user whose isAnonymous is true. The create hook above gives them full
		// consent; attributeRequest (openaiProxy.ts) routes their spend to the capped
		// demo key, metered to their own id. No onLinkAccount: when a demo user signs
		// in for real, Better Auth deletes the anonymous user row (default) and issues
		// a fresh session, so consent does NOT carry over — the real account starts at
		// the default. Their content-free usage rows survive (no FK cascade; see
		// db.ts) as disclosed demo billing data.
		anonymous({ emailDomainName: 'anonymous.invalid' }),
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

/**
 * The authenticated identity resolved from a session (app.ts's resolveUser). This is
 * the canonical shape every consumer narrows from: the OpenAI proxy takes just
 * `Pick<SessionUser, 'id' | 'isAnonymous'>` (ProxyUser) to decide who pays, while the
 * logging/consent routes also read `loggingConsent`. Defined here because auth owns
 * identity — it's a plain type, so importing it (type-only) never runs this module.
 */
export interface SessionUser {
	id: string;
	loggingConsent: ConsentLevel;
	/** True for anonymous (demo) sessions — spends the capped demo key, not the main one. */
	isAnonymous: boolean;
}
