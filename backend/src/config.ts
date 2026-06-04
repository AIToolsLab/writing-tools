// Load a local .env when present (dev). In Docker the env vars are injected by
// compose, and no .env exists, so loadEnvFile throws and we ignore it.
try {
	process.loadEnvFile?.();
} catch {
	// no .env file; rely on the process environment
}

// Local bare-metal default is 8000 to match the webpack dev-server proxy target.
// All Docker contexts set PORT=5000 explicitly (see docker-compose*.yml).
export const PORT = Number(process.env.PORT) || 8000;

export const DEBUG = (process.env.DEBUG ?? '').toLowerCase() === 'true';

// Read at request time via these helpers so tests can override the environment
// and so secrets are never cached across a rotation.
export const openaiApiKey = () => (process.env.OPENAI_API_KEY ?? '').trim();
export const logSecret = () => (process.env.LOG_SECRET ?? '').trim();
