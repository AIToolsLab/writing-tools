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

// Custom plugin to transform manifest.xml
function manifestPlugin(): Plugin {
	return {
		name: 'manifest-plugin',
		apply: 'build',
		async closeBundle() {
			const mode = process.env.NODE_ENV || 'development';
			const isDev = mode === 'development';

			// Read from public/manifest.xml (it gets copied to dist by publicDir)
			let content = fs.readFileSync('dist/manifest.xml', 'utf-8');

			if (!isDev) {
				content = content
					.replace(/-dev/g, '')
					.replace(new RegExp(idDev, 'g'), idProd)
					.replace(new RegExp(urlDev, 'g'), urlProd);
			}

			// Write back the transformed version
			fs.writeFileSync('dist/manifest.xml', content);
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
			manifestPlugin()
		],
		root: '.',
		publicDir: 'public', // Static assets copied to dist root
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
					taskpane: path.resolve(__dirname, 'taskpane.html'),
					editor: path.resolve(__dirname, 'editor.html'),
					logs: path.resolve(__dirname, 'logs.html'),
					popup: path.resolve(__dirname, 'popup.html'),
					commands: path.resolve(__dirname, 'commands.html')
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
