import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
	plugins: [react()],
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./vitest.setup.ts'],
		// Tests are added alongside ported code; keep the suite green until then.
		passWithNoTests: true,
		// Vitest owns *.test.ts(x); Playwright owns *.spec.ts under tests/. Keep the
		// two runners disjoint (see frontend/CLAUDE.md). legacy/ is the old webpack app
		// and is excluded until its tests are ported.
		include: ['**/*.test.{ts,tsx}'],
		exclude: ['node_modules', '.next', 'dist', 'tests', 'legacy'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: ['node_modules/', 'vitest.setup.ts', '**/*.config.*', '.next/'],
		},
	},
	resolve: {
		alias: {
			'@': path.resolve(__dirname, './'),
		},
	},
});
