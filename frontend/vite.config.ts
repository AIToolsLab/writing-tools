import { defineConfig, Plugin, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import fs from 'fs';
import { getHttpsServerOptions } from 'office-addin-dev-certs';
import http from 'node:http';

const urlDev = 'https://localhost:3000';
const urlProd = 'https://app.thoughtful-ai.com';
const backendDev = 'http://127.0.0.1:8000/';
const idProd = '46d2493d-60db-4522-b2aa-e6f2c08d2508';
const idDev = '46d2493d-60db-4522-b2aa-e6f2c08d2507';

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
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src')
			}
		},
		define: {
			'process.env.AUTH0_DOMAIN': JSON.stringify('dev-rbroo1fvav24wamu.us.auth0.com'),
			'process.env.AUTH0_CLIENT_ID': JSON.stringify('YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr'),
			// Device-flow client ID; must match a value in the backend's
			// BETTER_AUTH_DEVICE_CLIENT_IDS allowlist. Override via env for other envs.
			'process.env.BETTER_AUTH_DEVICE_CLIENT_ID': JSON.stringify(
				process.env.BETTER_AUTH_DEVICE_CLIENT_ID || 'writing-tools-editor-dev'
			),
		},
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
					popup: path.resolve(__dirname, 'popup.html'),
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
				'/api': apiProxy
			}
		},
		optimizeDeps: {
			include: ['react', 'react-dom']
		}
	};
});
