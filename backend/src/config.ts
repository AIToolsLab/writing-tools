// Load a local .env when present (dev). In Docker the env vars are injected by
// compose, and no .env exists, so loadEnvFile throws and we ignore it.
try {
	process.loadEnvFile?.();
} catch {
	// no .env file; rely on the process environment
}

// Local bare-metal default is 8000 to match the webpack dev-server proxy target.
// In production, the PORT is set by the environment.
export const PORT = Number(process.env.PORT) || 8000;

export const DEBUG = (process.env.DEBUG ?? '').toLowerCase() === 'true';

// Read at request time via these helpers so tests can override the environment
export const openaiApiKey = () => (process.env.OPENAI_API_KEY ?? '').trim();
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
export const betterAuthTrustedOrigins = (): string[] =>
	(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
export const googleClientId = () => (process.env.GOOGLE_CLIENT_ID ?? '').trim();
export const googleClientSecret = () =>
	(process.env.GOOGLE_CLIENT_SECRET ?? '').trim();
