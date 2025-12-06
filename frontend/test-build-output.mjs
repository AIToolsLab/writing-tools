#!/usr/bin/env node

/**
 * Regression tests for Vite build output
 *
 * These tests verify the issues caught during code review:
 * 1. HTML files must be at dist root (not dist/src/)
 * 2. Asset paths in HTML must be correct (/assets/...)
 * 3. Static files from public/ must be copied to dist root
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

// Test 1: HTML files must be at dist root, not in subdirectories
console.log('Test 1: HTML files location');
const expectedHtmlFiles = [
	'taskpane.html',
	'editor.html',
	'logs.html',
	'popup.html',
	'commands.html',
	'index.html' // from public/
];

expectedHtmlFiles.forEach(file => {
	const filePath = path.join(distDir, file);
	if (fs.existsSync(filePath)) {
		success(`${file} exists at dist root`);
	} else {
		error(`${file} NOT FOUND at dist root`);
	}
});

// Test 2: No HTML files should be in dist/src/ subdirectory
console.log('\nTest 2: No HTML in dist/src/');
const distSrcPath = path.join(distDir, 'src');
if (fs.existsSync(distSrcPath)) {
	const files = fs.readdirSync(distSrcPath, { recursive: true });
	const htmlFiles = files.filter(f => f.endsWith('.html'));
	if (htmlFiles.length > 0) {
		error(`Found HTML files in dist/src/: ${htmlFiles.join(', ')}`);
	} else {
		success('No HTML files in dist/src/');
	}
} else {
	success('No dist/src/ directory (good)');
}

// Test 3: Asset paths in HTML files must be absolute (/assets/...)
console.log('\nTest 3: Asset paths in HTML files');
expectedHtmlFiles.slice(0, 5).forEach(file => { // Skip index.html as it's static
	const filePath = path.join(distDir, file);
	if (fs.existsSync(filePath)) {
		const content = fs.readFileSync(filePath, 'utf-8');

		// Check for correct asset paths
		const hasCorrectAssetPaths = content.includes('/assets/') || content.includes('src="https://');
		const hasWrongRelativePaths = content.match(/src="\.\.\/assets\//);

		if (hasCorrectAssetPaths && !hasWrongRelativePaths) {
			success(`${file} has correct asset paths`);
		} else {
			error(`${file} has incorrect asset paths (should use /assets/...)`);
		}
	}
});

// Test 4: Static files from public/ must be copied to dist root
console.log('\nTest 4: Static files from public/');
const expectedStaticFiles = [
	'index.html',
	'styles.css',
	'longDescription.html',
	'privacypolicy.html',
	'support.html',
	'manifest.xml'
	// Note: c1.png, c2.png, logo_black.png are in src/assets/ and bundled with hashes
];

expectedStaticFiles.forEach(file => {
	const filePath = path.join(distDir, file);
	if (fs.existsSync(filePath)) {
		success(`Static file ${file} copied correctly`);
	} else {
		error(`Static file ${file} NOT FOUND in dist`);
	}
});

// Test 5: Assets directory structure
console.log('\nTest 5: Assets directory structure');
const assetsDir = path.join(distDir, 'assets');
if (fs.existsSync(assetsDir)) {
	const files = fs.readdirSync(assetsDir);
	const jsFiles = files.filter(f => f.endsWith('.js'));
	const cssFiles = files.filter(f => f.endsWith('.css'));
	const imageFiles = files.filter(f => f.match(/\.(png|jpg|jpeg|svg|webp)$/));

	if (jsFiles.length > 0) {
		success(`Found ${jsFiles.length} JS files in assets/`);
	} else {
		error('No JS files found in assets/');
	}

	if (cssFiles.length > 0) {
		success(`Found ${cssFiles.length} CSS files in assets/`);
	} else {
		error('No CSS files found in assets/');
	}

	if (imageFiles.length > 0) {
		success(`Found ${imageFiles.length} image files in assets/`);
	} else {
		error('No image files found in assets/');
	}
} else {
	error('Assets directory does not exist!');
}

// Test 6: Manifest.xml should exist and be transformed for production
console.log('\nTest 6: Manifest.xml');
const manifestPath = path.join(distDir, 'manifest.xml');
if (fs.existsSync(manifestPath)) {
	const content = fs.readFileSync(manifestPath, 'utf-8');
	success('manifest.xml exists in dist');

	// This test depends on build mode, so we'll just check it exists
	if (content.includes('localhost') || content.includes('app.thoughtful-ai.com')) {
		success('manifest.xml has valid URLs');
	} else {
		error('manifest.xml appears malformed');
	}
} else {
	error('manifest.xml NOT FOUND in dist');
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
