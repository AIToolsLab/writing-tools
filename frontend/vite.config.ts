import { defineConfig, type Plugin, type ProxyOptions, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { getHttpsServerOptions } from 'office-addin-dev-certs';
import http from 'node:http';
import {
	MANIFEST_ENV_NAMES,
	MANIFEST_ENVS,
	TEMPLATE_RELATIVE_PATH,
	renderManifest,
} from './manifest/environments';

const urlProd = MANIFEST_ENVS.prod.baseUrl;
const backendDev = 'http://127.0.0.1:8000/';

// Selects the Google Docs add-on build — a single self-contained IIFE bundle
// (dist/google-docs.bundle.js) that the Apps Script sidebar loads by URL — instead
// of the default multi-page Word/editor build. Set by the `build:google-docs` npm
// scripts via BUILD_TARGET=google-docs. This axis is orthogonal to --mode, which
// still selects dev vs prod for either target.
const isGoogleDocs = process.env.BUILD_TARGET === 'google-docs';

// Render manifest/template.xml into dist/ once per environment (see
// manifest/environments.ts for the table of what differs).
//
// Every build emits every environment's manifest, deliberately: which manifest
// you need depends on who's asking, not on the flags that produced the build.
// Tying them to --mode is what left the deployed image serving a manifest that
// named the prod origin regardless of where it was deployed.
//
// Manifests are sideloaded or uploaded to an add-in store, never fetched from a
// running server, so these are build artifacts only — nothing needs to serve
// them and the dev server doesn't.
function manifestPlugin(): Plugin {
	return {
		name: 'manifest-plugin',
		apply: 'build',
		closeBundle() {
			// __dirname, not import.meta: Vite bundles this config as CJS (the
			// package has no "type": "module"). environments.ts stays free of
			// filesystem access so its test can resolve the same file as ESM.
			const template = fs.readFileSync(
				path.resolve(__dirname, TEMPLATE_RELATIVE_PATH),
				'utf-8',
			);
			for (const name of MANIFEST_ENV_NAMES) {
				const env = MANIFEST_ENVS[name];
				fs.writeFileSync(
					path.resolve(__dirname, 'dist', env.fileName),
					renderManifest(template, env),
				);
			}
		},
	};
}

export default defineConfig(async ({ mode }): Promise<UserConfig> => {
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
			// false). Disable publicDir copying so it does NOT re-copy public/ over
			// the main build's output. (The manifests are rendered by
			// manifestPlugin rather than copied from public/, so they're no longer
			// among the files at risk here — but re-copying the rest is still waste.)
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
				ca: serverOptions.ca,
			};
		} catch (error) {
			console.warn('Failed to get HTTPS options, using HTTP:', error);
		}
	}

	// Annotated so the `configure` callback params get contextual types
	// (the inline `proxy: { ... }` record types them as `string | ProxyOptions`,
	// which defeats inference and leaves the callback args as implicit `any`).
	const apiProxy: ProxyOptions = {
		target: backendDev,
		changeOrigin: true,
		secure: false,
		// Don't reuse keep-alive sockets to the dev backend. Node's http server
		// closes idle sockets after ~5s; if http-proxy reuses one mid-close we get
		// a silent empty response (Content-Length: 0). A fresh socket per request
		// avoids that race. Dev-only.
		agent: new http.Agent({ keepAlive: false }),
		configure: (proxy) => {
			proxy.on('error', (err, _req, res) => {
				console.error('[vite proxy] /api error:', err.message);
				if ('writeHead' in res && !res.headersSent) {
					res.writeHead(502, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({ detail: 'Proxy error', message: err.message }),
					);
				}
			});
		}
	};

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
					commands: path.resolve(__dirname, 'commands.html'),
					'mywords-demo': path.resolve(__dirname, 'mywords-demo.html'),
					account: path.resolve(__dirname, 'account.html'),
				},
				output: {
					manualChunks: {
						'react-vendor': ['react', 'react-dom'],
					},
				},
			},
		},
		server: {
			port: 3000,
			https: httpsOptions,
			cors: true,
			headers: {
				'Access-Control-Allow-Origin': '*',
			},
			proxy: {
				'/api': apiProxy,
			},
		},
		optimizeDeps: {
			include: ['react', 'react-dom'],
		},
	};
});
