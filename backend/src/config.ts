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
export const logSecret = () => (process.env.LOG_SECRET ?? '').trim();

// LiveKit — used to mint room-join tokens for the My Words voice tab. The
// browser gets a short-lived JWT; the API secret never leaves the server. See
// voice-agent/ (the Python worker) and docs/my-words-voice-native-research.md.
export const livekitUrl = () => (process.env.LIVEKIT_URL ?? '').trim();
export const livekitApiKey = () => (process.env.LIVEKIT_API_KEY ?? '').trim();
export const livekitApiSecret = () =>
	(process.env.LIVEKIT_API_SECRET ?? '').trim();

// Auth — opt-in via BETTER_AUTH_ENABLED=true
export const authEnabled = () =>
	(process.env.BETTER_AUTH_ENABLED ?? '').toLowerCase() === 'true';

export const betterAuthSecret = () =>
	(process.env.BETTER_AUTH_SECRET ?? '').trim();
// Empty string counts as absent: compose's `${BETTER_AUTH_URL:-}` and a blank
// .env line both yield '', which `??` alone would let through.
export const betterAuthUrl = () =>
	(process.env.BETTER_AUTH_URL ?? '').trim() || 'http://localhost:8000';
export const betterAuthTrustedOrigins = (): string[] =>
	(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
export const googleClientId = () => (process.env.GOOGLE_CLIENT_ID ?? '').trim();
export const googleClientSecret = () =>
	(process.env.GOOGLE_CLIENT_SECRET ?? '').trim();

// Comma-separated allowed device client IDs. An empty list rejects all requests.
export const deviceClientIds = (): string[] =>
	(process.env.BETTER_AUTH_DEVICE_CLIENT_IDS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
