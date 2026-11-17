import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Node >= 25 ships the Web Storage API on by default, so `localStorage` is a
// global before jsdom loads — but an unusable one, since it stays undefined
// unless the process was started with `--localstorage-file`. Vitest's DOM
// environments only copy a window property onto globalThis when nothing is
// there already (`populateGlobal`), so Node's stub shadows jsdom's real
// Storage and every `localStorage.x` in a test throws. happy-dom is affected
// identically — this is the runner's key filter, not the DOM library.
// See https://github.com/vitest-dev/vitest/issues/8757.
//
// Turning Web Storage back off restores the pre-25 behavior. The flag doesn't
// exist before Node 25 (`bad option: --no-webstorage` aborts the worker), so
// only pass it where Node knows it. `allowedNodeEnvironmentFlags` records the
// positive form, `--webstorage`, for both spellings.
const disableNodeWebStorage = process.allowedNodeEnvironmentFlags.has(
	'--webstorage',
)
	? ['--no-webstorage']
	: [];

export default defineConfig({
	resolve: {
		// Mirror the webpack "@/*" -> "./src/*" alias so tests import the same way as app code.
		alias: { '@': resolve(__dirname, './src') },
	},
	test: {
		// Only our unit tests under src/. Playwright owns tests/*.spec.ts and has
		// its own runner, so keep Vitest out of that directory.
		include: ['src/**/*.{test,spec}.{ts,tsx}'],
		// Logic-layer tests run in node. Switch specific files to jsdom (via a
		// `// @vitest-environment jsdom` docblock) once we add component tests.
		environment: 'node',
		restoreMocks: true,
		unstubGlobals: true,
		unstubEnvs: true,
		// Test environments are set up inside the pool workers, so that's where
		// the flag has to land — the main process never touches localStorage.
		execArgv: disableNodeWebStorage,
	},
});
