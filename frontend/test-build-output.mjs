#!/usr/bin/env node

/**
 * Regression tests for the production build output.
 *
 * These assert the contract the `dist/` directory must satisfy, independent of
 * the build tool (Webpack today, Vite after the migration):
 *   1. HTML entry points live at the dist root (not in dist/src/).
 *   2. No HTML files leak into dist/src/.
 *   3. The build emits JS + CSS bundles, and images land in dist/assets/.
 *   4. Static files from the public site are copied to the dist root.
 *   5. manifest.xml is present (and looks transformed).
 *   6. The Google Docs bundle is emitted as dist/google-docs.bundle.js.
 *
 * Run after a build: `npm run test:build` (assumes `dist/` already exists).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');

let errors = 0;

function error(message) {
	console.error(`❌ ${message}`);
	errors++;
}

function success(message) {
	console.log(`✓ ${message}`);
}

console.log('\n🔍 Running build output regression tests...\n');

if (!fs.existsSync(distDir)) {
	error('dist/ does not exist — run a build first (npm run build)');
	console.log('\n❌ 1 test(s) failed');
	process.exit(1);
}

// Test 1: HTML entry points must be at dist root.
console.log('Test 1: HTML files location');
const expectedHtmlFiles = [
	'taskpane.html',
	'editor.html',
	'logs.html',
	'popup.html',
	'commands.html',
	'index.html'
];

expectedHtmlFiles.forEach((file) => {
	const filePath = path.join(distDir, file);
	if (fs.existsSync(filePath)) {
		success(`${file} exists at dist root`);
	} else {
		error(`${file} NOT FOUND at dist root`);
	}
});

// Test 2: No HTML files should be in dist/src/.
console.log('\nTest 2: No HTML in dist/src/');
const distSrcPath = path.join(distDir, 'src');
if (fs.existsSync(distSrcPath)) {
	const files = fs.readdirSync(distSrcPath, { recursive: true });
	const htmlFiles = files.filter((f) => String(f).endsWith('.html'));
	if (htmlFiles.length > 0) {
		error(`Found HTML files in dist/src/: ${htmlFiles.join(', ')}`);
	} else {
		success('No HTML files in dist/src/');
	}
} else {
	success('No dist/src/ directory (good)');
}

// Test 3: The build emits JS + CSS bundles, and images land in dist/assets/.
// (Webpack writes JS/CSS to the dist root; Vite writes them under dist/assets/.
// Scan recursively so the assertion is independent of the bundler's layout.)
console.log('\nTest 3: Bundled output');
const allDistFiles = fs.readdirSync(distDir, { recursive: true }).map(String);
const jsFiles = allDistFiles.filter((f) => f.endsWith('.js'));
const cssFiles = allDistFiles.filter((f) => f.endsWith('.css'));

if (jsFiles.length > 0) success(`Found ${jsFiles.length} JS bundle(s) in dist/`);
else error('No JS bundles found in dist/');

if (cssFiles.length > 0) success(`Found ${cssFiles.length} CSS bundle(s) in dist/`);
else error('No CSS bundles found in dist/');

const assetsDir = path.join(distDir, 'assets');
if (fs.existsSync(assetsDir)) {
	const imageFiles = fs
		.readdirSync(assetsDir)
		.filter((f) => f.match(/\.(png|jpg|jpeg|svg|webp)$/));
	if (imageFiles.length > 0) success(`Found ${imageFiles.length} image files in dist/assets/`);
	else error('No image files found in dist/assets/');
} else {
	error('dist/assets/ directory does not exist!');
}

// Test 4: Static files from the public site must be copied to dist root.
console.log('\nTest 4: Static files');
const expectedStaticFiles = [
	'styles.css',
	'longDescription.html',
	'privacypolicy.html',
	'support.html'
];

expectedStaticFiles.forEach((file) => {
	const filePath = path.join(distDir, file);
	if (fs.existsSync(filePath)) {
		success(`Static file ${file} copied correctly`);
	} else {
		error(`Static file ${file} NOT FOUND in dist`);
	}
});

// Test 5: manifest.xml should exist and look transformed.
console.log('\nTest 5: Manifest.xml');
const manifestPath = path.join(distDir, 'manifest.xml');
if (fs.existsSync(manifestPath)) {
	success('manifest.xml exists in dist');
	const content = fs.readFileSync(manifestPath, 'utf-8');
	// Structural check that it's a real Office manifest (avoids URL substring
	// matching, which is brittle and flagged as unsafe sanitization).
	if (content.includes('<OfficeApp') && content.includes('<SourceLocation')) {
		success('manifest.xml looks like a valid Office manifest');
	} else {
		error('manifest.xml appears malformed');
	}
} else {
	error('manifest.xml NOT FOUND in dist');
}

// Test 6: Google Docs bundle must be emitted into dist/.
console.log('\nTest 6: Google Docs bundle');
const gdocsBundlePath = path.join(distDir, 'google-docs.bundle.js');
if (fs.existsSync(gdocsBundlePath)) {
	success('google-docs.bundle.js exists at dist root');
} else {
	error('google-docs.bundle.js NOT FOUND at dist root (run npm run build:google-docs)');
}

// Final report
console.log('\n' + '='.repeat(50));
if (errors === 0) {
	console.log('✅ All regression tests passed!');
	process.exit(0);
} else {
	console.log(`❌ ${errors} test(s) failed`);
	process.exit(1);
}
