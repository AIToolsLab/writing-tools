import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Build config for the Google Docs add-on.
 *
 * Produces a single self-contained IIFE bundle, dist/google-docs.bundle.js,
 * that the Apps Script sidebar loads by URL. Assets are inlined as base64
 * (like the old webpack `asset/inline`) so there is just one JS file to load.
 * Emits into the shared dist/ with emptyOutDir:false so it co-exists with the
 * main `vite build` output — run `vite build` first, then this config.
 */
export default defineConfig(({ mode }) => {
	const isDev = mode === 'development';

	return {
		plugins: [react()],
		// This lib build runs after `vite build` into the same dist/ (emptyOutDir
		// is false). Disable publicDir copying so it does NOT re-copy public/ over
		// the main build's output — in particular the prod-transformed
		// dist/manifest.xml, which would otherwise be clobbered with the raw dev
		// manifest (localhost:3000 / -dev id).
		publicDir: false,
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src')
			}
		},
		define: {
			'process.env.AUTH0_DOMAIN': JSON.stringify('dev-rbroo1fvav24wamu.us.auth0.com'),
			'process.env.AUTH0_CLIENT_ID': JSON.stringify('YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr'),
			'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
			// Backend origin for the sidebar: empty in dev (reaches the backend via
			// the dev server's /api proxy); the deployed origin in prod.
			'process.env.GDOCS_BACKEND_URL': JSON.stringify(
				isDev ? '' : 'https://app.thoughtful-ai.com'
			)
		},
		build: {
			outDir: 'dist',
			emptyOutDir: false,
			sourcemap: isDev,
			// Inline every asset as base64 so the bundle is a single file.
			assetsInlineLimit: Number.MAX_SAFE_INTEGER,
			cssCodeSplit: false,
			lib: {
				entry: path.resolve(__dirname, 'src/index-gdocs.tsx'),
				formats: ['iife'],
				name: 'GoogleDocsAddon',
				fileName: () => 'google-docs.bundle.js'
			}
		}
	};
});
