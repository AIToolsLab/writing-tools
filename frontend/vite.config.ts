import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { getHttpsServerOptions } from 'office-addin-dev-certs';

const urlDev = 'https://localhost:3000';
const urlProd = 'https://app.thoughtful-ai.com';
const backendDev = 'http://0.0.0.0:8000/';
const idProd = '46d2493d-60db-4522-b2aa-e6f2c08d2508';
const idDev = '46d2493d-60db-4522-b2aa-e6f2c08d2507';

// Selects the Google Docs add-on build — a single self-contained IIFE bundle
// (dist/google-docs.bundle.js) that the Apps Script sidebar loads by URL — instead
// of the default multi-page Word/editor build. Set by the `build:google-docs` npm
// scripts via BUILD_TARGET=google-docs. This axis is orthogonal to --mode, which
// still selects dev vs prod for either target.
const isGoogleDocs = process.env.BUILD_TARGET === 'google-docs';

// Transform the manifest.xml that publicDir copies into dist/: in production
// strip the -dev markers and swap the dev id/url for the prod ones.
function manifestPlugin(): Plugin {
	return {
		name: 'manifest-plugin',
		apply: 'build',
		closeBundle() {
			const isDev = process.env.NODE_ENV === 'development';
			const manifestPath = path.resolve(__dirname, 'dist/manifest.xml');
			if (!fs.existsSync(manifestPath)) return;

			let content = fs.readFileSync(manifestPath, 'utf-8');
			if (!isDev) {
				content = content
					.replace(/-dev/g, '')
					.replace(new RegExp(idDev, 'g'), idProd)
					.replace(new RegExp(urlDev, 'g'), urlProd);
			}
			fs.writeFileSync(manifestPath, content);
		}
	};
}

export default defineConfig(async ({ mode }) => {
	const isDev = mode === 'development';

	// Shared compile-time substitutions, declared once so the two build targets can
	// never drift. A define missing from one target is what shipped a bare
	// `process.env.…` into a bundle ("process is not defined" at runtime) — both the
	// gdocs IIFE (BETTER_AUTH_DEVICE_CLIENT_ID) and, latently, the Word build
	// (GDOCS_BACKEND_URL, dead behind the RUNNING_IN_GOOGLE_DOCS guard) hit this.
	const define = {
		'process.env.NODE_ENV': JSON.stringify(isDev ? 'development' : 'production'),
		// Backend origin for the gdocs sidebar: empty in dev (reaches the backend via
		// the dev server's /api proxy); the deployed origin in prod. Inert in the Word
		// build but defined for both so no bare process.env ref survives anywhere.
		'process.env.GDOCS_BACKEND_URL': JSON.stringify(isDev ? '' : urlProd),
		// Device-flow client ID; must match a value in the backend's
		// BETTER_AUTH_DEVICE_CLIENT_IDS allowlist. Override via env for other envs.
		'process.env.BETTER_AUTH_DEVICE_CLIENT_ID': JSON.stringify(
			process.env.BETTER_AUTH_DEVICE_CLIENT_ID || 'writing-tools-editor-dev'
		)
	};

	const resolve = {
		alias: {
			'@': path.resolve(__dirname, './src')
		}
	};

	// Google Docs add-on: an IIFE with every image/font inlined as base64 (like the
	// old webpack `asset/inline`). The sidebar loads two files by URL — the JS bundle
	// plus google-docs.css (CSS is extracted, not inlined; see assetFileNames below).
	// Emits into the shared dist/ with emptyOutDir:false so it co-exists with the
	// main build's output — run `vite build` first, then this.
	if (isGoogleDocs) {
		return {
			plugins: [react()],
			// Runs after the main `vite build` into the same dist/ (emptyOutDir is
			// false). Disable publicDir copying so it does NOT re-copy public/ over the
			// main build's output — in particular the prod-transformed dist/manifest.xml,
			// which would otherwise be clobbered with the raw dev manifest.
			publicDir: false,
			resolve,
			define,
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
				},
				rollupOptions: {
					// The extracted CSS is the only emitted asset (everything else is
					// inlined above). Name it google-docs.css to match the <link> the
					// Apps Script sidebar injects — lib mode otherwise names it after the
					// package (thoughtful-ai-app.css), which 404s and ships an unstyled
					// sidebar.
					output: {
						assetFileNames: 'google-docs.[ext]'
					}
				}
			}
		};
	}

	// Default: multi-page Word add-in + standalone editor build / dev server.
	let httpsOptions;
	if (isDev) {
		try {
			const serverOptions = await getHttpsServerOptions();
			httpsOptions = {
				key: serverOptions.key,
				cert: serverOptions.cert,
				ca: serverOptions.ca
			};
		} catch (error) {
			console.warn('Failed to get HTTPS options, using HTTP:', error);
		}
	}

	return {
		// Multi-page app: don't fall back to index.html for unknown paths.
		appType: 'mpa' as const,
		plugins: [react(), manifestPlugin()],
		root: '.',
		publicDir: 'public',
		resolve,
		define,
		build: {
			outDir: 'dist',
			emptyOutDir: true,
			sourcemap: true,
			rollupOptions: {
				input: {
					index: path.resolve(__dirname, 'index.html'),
					taskpane: path.resolve(__dirname, 'taskpane.html'),
					editor: path.resolve(__dirname, 'editor.html'),
					logs: path.resolve(__dirname, 'logs.html'),
					commands: path.resolve(__dirname, 'commands.html')
				},
				output: {
					manualChunks: {
						'react-vendor': ['react', 'react-dom']
					}
				}
			}
		},
		server: {
			port: 3000,
			https: httpsOptions,
			cors: true,
			headers: {
				'Access-Control-Allow-Origin': '*'
			},
			proxy: {
				'/api': {
					target: backendDev,
					changeOrigin: true,
					secure: false
				}
			}
		},
		optimizeDeps: {
			include: ['react', 'react-dom']
		}
	};
});
