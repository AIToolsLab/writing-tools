/**
 * @format
 */

import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

import '@testing-library/jest-dom';

// Cleanup after each test
afterEach(() => {
	cleanup();
});

// Mock the Office API if needed
global.Office = {
	context: {
		document: {},
	},
} as any;
