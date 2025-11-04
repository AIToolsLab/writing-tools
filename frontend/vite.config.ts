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

// Custom plugin to copy and transform manifest.xml
function manifestPlugin(): Plugin {
	return {
		name: 'manifest-plugin',
		apply: 'build',
		async closeBundle() {
			const mode = process.env.NODE_ENV || 'development';
			const isDev = mode === 'development';

			// Ensure dist directory exists
			if (!fs.existsSync('dist')) {
				fs.mkdirSync('dist', { recursive: true });
			}

			let content = fs.readFileSync('manifest.xml', 'utf-8');

			if (!isDev) {
				content = content
					.replace(/-dev/g, '')
					.replace(new RegExp(idDev, 'g'), idProd)
					.replace(new RegExp(urlDev, 'g'), urlProd);
			}

			fs.writeFileSync('dist/manifest.xml', content);
		}
	};
}

// Custom plugin to copy static assets and move HTML files
function copyStaticAssets(): Plugin {
	return {
		name: 'copy-static-assets',
		apply: 'build',
		async closeBundle() {
			const staticDir = 'src/static';
			const assetsDir = 'assets';

			// Copy static files
			if (fs.existsSync(staticDir)) {
				const files = fs.readdirSync(staticDir);
				files.forEach(file => {
					fs.copyFileSync(
						path.join(staticDir, file),
						path.join('dist', file)
					);
				});
			}

			// Copy assets directory
			if (fs.existsSync(assetsDir)) {
				if (!fs.existsSync('dist/assets')) {
					fs.mkdirSync('dist/assets', { recursive: true });
				}
				const files = fs.readdirSync(assetsDir);
				files.forEach(file => {
					fs.copyFileSync(
						path.join(assetsDir, file),
						path.join('dist/assets', file)
					);
				});
			}

			// Move HTML files from src subdirectories to dist root
			const htmlMappings = [
				{ from: 'dist/src/taskpane.html', to: 'dist/taskpane.html' },
				{ from: 'dist/src/popup.html', to: 'dist/popup.html' },
				{ from: 'dist/src/editor/editor.html', to: 'dist/editor.html' },
				{ from: 'dist/src/logs/logs.html', to: 'dist/logs.html' },
				{ from: 'dist/src/commands/commands.html', to: 'dist/commands.html' }
			];

			htmlMappings.forEach(({ from, to }) => {
				if (fs.existsSync(from)) {
					fs.copyFileSync(from, to);
				}
			});

			// Clean up src directory in dist
			if (fs.existsSync('dist/src')) {
				fs.rmSync('dist/src', { recursive: true, force: true });
			}
		}
	};
}

export default defineConfig(async ({ mode }) => {
	const isDev = mode === 'development';

	// Get HTTPS options for dev server
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
		plugins: [
			react(),
			manifestPlugin(),
			copyStaticAssets()
		],
		root: '.',
		publicDir: false, // We handle assets manually
		resolve: {
			alias: {
				'@': path.resolve(__dirname, './src')
			}
		},
		define: {
			'process.env.AUTH0_DOMAIN': JSON.stringify('dev-rbroo1fvav24wamu.us.auth0.com'),
			'process.env.AUTH0_CLIENT_ID': JSON.stringify('YZhokQZRgE2YUqU5Is9LcaMiCzujoaVr')
		},
		css: {
			modules: {
				localsConvention: 'camelCase'
			}
		},
		build: {
			outDir: 'dist',
			emptyOutDir: true,
			sourcemap: true,
			rollupOptions: {
				input: {
					taskpane: path.resolve(__dirname, 'src/taskpane.html'),
					editor: path.resolve(__dirname, 'src/editor/editor.html'),
					logs: path.resolve(__dirname, 'src/logs/logs.html'),
					popup: path.resolve(__dirname, 'src/popup.html'),
					commands: path.resolve(__dirname, 'src/commands/commands.html')
				},
				output: {
					// Code splitting for better caching
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
			include: ['react', 'react-dom', 'core-js', 'regenerator-runtime']
		}
	};
});
