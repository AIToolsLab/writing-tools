#!/usr/bin/env node

/**
 * Regression tests for the Vite dev server endpoints.
 *
 * Verifies the dev server serves files at the paths the add-in expects:
 *   1. HTML entry points are reachable at root paths.
 *   2. Static files from public/ are served.
 *   3. Assets under public/assets/ are reachable at /assets/.
 *   4. Non-existent paths (and the old nested src/ paths) return 404.
 *
 * Prereq: the dev server must be running — `npm run dev-server`.
 */

import https from 'https';
import { getHttpsServerOptions } from 'office-addin-dev-certs';

const BASE_URL = 'https://localhost:3000';
let errors = 0;
// The dev server uses the office-addin-dev-certs self-signed cert; validate
// against that CA rather than disabling certificate validation.
let caCert;

function error(message) {
	console.error(`❌ ${message}`);
	errors++;
}

function success(message) {
	console.log(`✓ ${message}`);
}

function testEndpoint(path, expectedStatus = 200) {
	return new Promise((resolve) => {
		https
			.get(`${BASE_URL}${path}`, { ca: caCert }, (res) => {
				if (res.statusCode === expectedStatus) {
					success(`GET ${path} -> ${res.statusCode}`);
					resolve(true);
				} else {
					error(`GET ${path} -> ${res.statusCode} (expected ${expectedStatus})`);
					resolve(false);
				}
			})
			.on('error', (err) => {
				error(`GET ${path} -> ERROR: ${err.message}`);
				resolve(false);
			});
	});
}

async function runTests() {
	console.log('\n🔍 Running dev server endpoint regression tests...\n');
	console.log('⚠️  Make sure dev server is running: npm run dev-server\n');

	caCert = (await getHttpsServerOptions()).ca;

	console.log('Test 1: HTML entry points accessibility');
	await testEndpoint('/taskpane.html');
	await testEndpoint('/editor.html');
	await testEndpoint('/logs.html');
	await testEndpoint('/popup.html');
	await testEndpoint('/commands.html');

	console.log('\nTest 2: Static files from public/');
	await testEndpoint('/index.html');
	await testEndpoint('/styles.css');
	await testEndpoint('/longDescription.html');
	await testEndpoint('/manifest.xml');

	console.log('\nTest 3: Asset files from public/assets/');
	await testEndpoint('/assets/about.png');
	await testEndpoint('/assets/sparkle.png');

	console.log('\nTest 4: Non-existent / old paths return 404');
	await testEndpoint('/nonexistent.html', 404);
	await testEndpoint('/src/taskpane.html', 404);

	console.log('\n' + '='.repeat(50));
	if (errors === 0) {
		console.log('✅ All dev server tests passed!');
		process.exit(0);
	} else {
		console.log(`❌ ${errors} test(s) failed`);
		console.log('\n💡 Make sure the dev server is running: npm run dev-server');
		process.exit(1);
	}
}

runTests().catch((err) => {
	console.error('Test runner error:', err);
	process.exit(1);
});
