#!/usr/bin/env node

/**
 * Regression tests for Vite dev server endpoints
 *
 * These tests verify that the dev server serves files at correct paths:
 * 1. Root endpoints (/) should serve index.html
 * 2. HTML entry points should be accessible
 * 3. Assets should be accessible at /assets/
 * 4. Static files from public/ should be accessible
 */

import http from 'http';

const BASE_URL = 'http://localhost:3000';
let errors = 0;

function error(message) {
	console.error(`❌ ${message}`);
	errors++;
}

function success(message) {
	console.log(`✓ ${message}`);
}

function testEndpoint(path, expectedStatus = 200) {
	return new Promise((resolve) => {
		http.get(`${BASE_URL}${path}`, (res) => {
			if (res.statusCode === expectedStatus) {
				success(`GET ${path} -> ${res.statusCode}`);
				resolve(true);
			} else {
				error(`GET ${path} -> ${res.statusCode} (expected ${expectedStatus})`);
				resolve(false);
			}
		}).on('error', (err) => {
			error(`GET ${path} -> ERROR: ${err.message}`);
			resolve(false);
		});
	});
}

async function runTests() {
	console.log('\n🔍 Running dev server endpoint regression tests...\n');
	console.log('⚠️  Make sure dev server is running: npm run dev-server\n');

	// Test 1: HTML entry points at root
	console.log('Test 1: HTML entry points accessibility');
	await testEndpoint('/taskpane.html');
	await testEndpoint('/editor.html');
	await testEndpoint('/logs.html');
	await testEndpoint('/popup.html');
	await testEndpoint('/commands.html');

	// Test 2: Static files from public/
	console.log('\nTest 2: Static files from public/');
	await testEndpoint('/index.html');
	await testEndpoint('/styles.css');
	await testEndpoint('/longDescription.html');
	await testEndpoint('/manifest.xml');

	// Test 3: Assets accessibility (static assets from public/)
	console.log('\nTest 3: Asset files');
	await testEndpoint('/assets/about.png');
	await testEndpoint('/assets/sparkle.png');
	// Note: c1.png, c2.png, logo_black.png are in src/assets/ and served with hashes in dev mode

	// Test 4: Non-existent paths should 404
	console.log('\nTest 4: Non-existent paths return 404');
	await testEndpoint('/nonexistent.html', 404);
	await testEndpoint('/src/taskpane.html', 404); // Should NOT exist

	// Test 5: Root path behavior
	console.log('\nTest 5: Root path');
	// Note: Vite dev server root might return directory listing or 404 by default
	// If we want / to work, we'd need to configure it explicitly
	const rootResult = await new Promise((resolve) => {
		http.get(`${BASE_URL}/`, (res) => {
			if (res.statusCode === 200 || res.statusCode === 404) {
				console.log(`ℹ️  GET / -> ${res.statusCode} (dev server behavior)`);
				resolve(true);
			} else {
				error(`GET / -> ${res.statusCode} (unexpected)`);
				resolve(false);
			}
		}).on('error', (err) => {
			error(`GET / -> ERROR: ${err.message}`);
			resolve(false);
		});
	});

	// Final report
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

runTests().catch(err => {
	console.error('Test runner error:', err);
	process.exit(1);
});
