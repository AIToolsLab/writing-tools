import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

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
	},
});
