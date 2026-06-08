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
