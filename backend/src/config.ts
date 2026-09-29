import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load a local .env when present (dev). In Docker the env vars are injected by
// compose, and no .env exists, so loadEnvFile throws and we ignore it.
try {
	process.loadEnvFile?.();
} catch {
	// no .env file; rely on the process environment
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Single persistent storage root for the SQLite auth DB and the study logs, so a
// deployment only has to mount and configure one directory. Defaults to
// backend/data (resolved from both src/ in dev and dist/ in the built image),
// preserving the previous auth.db location. In k8s, set DATA_DIR to the mounted
// volume path. LOG_DIR (see logging.ts) still overrides just the logs subdir.
export const dataDir = (): string =>
	(process.env.DATA_DIR ?? '').trim() || path.resolve(__dirname, '../data');

// Local bare-metal default is 8000 to match the webpack dev-server proxy target.
// In production, the PORT is set by the environment.
export const PORT = Number(process.env.PORT) || 8000;

export const DEBUG = (process.env.DEBUG ?? '').toLowerCase() === 'true';

// Set at image build time (see repo-root Dockerfile); 'unknown' in local dev.
export const gitCommit = () => (process.env.GIT_COMMIT ?? 'unknown').trim();

// Read at request time via these helpers so tests can override the environment
export const openaiApiKey = () => (process.env.OPENAI_API_KEY ?? '').trim();

// Key for the Thoughtful-demo OpenAI project, used to serve requests that carry no
// session (demo mode, and the standalone editor before sign-in). Separate from the
// main key so its spend is capped on OpenAI's side rather than by us. When unset,
// unauthenticated requests are refused wherever auth is enabled — see openaiProxy.ts.
export const openaiDemoApiKey = () =>
	(process.env.OPENAI_DEMO_API_KEY ?? '').trim();

export const logSecret = () => (process.env.LOG_SECRET ?? '').trim();

// Auth — opt-in via BETTER_AUTH_ENABLED=true
export const authEnabled = () =>
	(process.env.BETTER_AUTH_ENABLED ?? '').toLowerCase() === 'true';

export const betterAuthSecret = () =>
	(process.env.BETTER_AUTH_SECRET ?? '').trim();
// Empty string counts as absent: compose's `${BETTER_AUTH_URL:-}` and a blank
// .env line both yield '', which `??` alone would let through.
export const betterAuthUrl = () =>
	(process.env.BETTER_AUTH_URL ?? '').trim() || 'http://localhost:8000';
// OAuth resource indicators and JWT audiences are compared as exact strings.
// Canonicalize the configured URL once so both the authorization server and
// resource server use an origin with no path or trailing slash.
export const betterAuthOrigin = () => new URL(betterAuthUrl()).origin;
// Better Auth includes this base path in the OAuth JWT issuer. Keep it explicit
// and shared with the resource verifier; the bare origin rejects valid tokens.
export const BETTER_AUTH_BASE_PATH = '/api/auth';
export const betterAuthTrustedOrigins = (): string[] =>
	(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
export const googleClientId = () => (process.env.GOOGLE_CLIENT_ID ?? '').trim();
export const googleClientSecret = () =>
	(process.env.GOOGLE_CLIENT_SECRET ?? '').trim();

// Fixed public OAuth client for the separately hosted Mindmap. Optional: when
// either value is unset, Mindmap login is simply off. There are deliberately no
// code defaults (dev values come from scripts/get_env.py), so no environment can
// register a localhost redirect by accident — e.g. the k8s migrate initContainer,
// which runs without NODE_ENV. The client id is an identifier, not a secret.
export const mindmapOAuthClientId = (): string =>
	(process.env.MINDMAP_OAUTH_CLIENT_ID ?? '').trim();

export const mindmapOAuthRedirectUris = (): string[] => [
	...new Set(
		(process.env.MINDMAP_OAUTH_REDIRECT_URIS ?? '')
			.split(',')
			.map((value) => value.trim())
			.filter(Boolean),
	),
];

/** A first-party public OAuth client this backend provisions and accepts. */
export interface TrustedOAuthClient {
	clientId: string;
	name: string;
	redirectUris: string[];
}

// The hardcoded list of OAuth clients the backend provisions at startup and whose
// tokens the OpenAI proxy accepts. One entry today: the standalone Mindmap, whose
// id and redirects come from the MINDMAP_OAUTH_* env vars above. Adding a client
// means adding an entry here. Incomplete entries are dropped rather than
// provisioned half-configured, so an unconfigured client is simply disabled.
export const trustedOAuthClients = (): TrustedOAuthClient[] =>
	[
		{
			clientId: mindmapOAuthClientId(),
			name: 'Writing Tools Mindmap',
			redirectUris: mindmapOAuthRedirectUris(),
		},
	].filter((client) => client.clientId && client.redirectUris.length > 0);

export const acceptedOAuthClientIds = (): string[] =>
	trustedOAuthClients().map((client) => client.clientId);

// Comma-separated allowed device client IDs. An empty list rejects all requests.
export const deviceClientIds = (): string[] =>
	(process.env.BETTER_AUTH_DEVICE_CLIENT_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
