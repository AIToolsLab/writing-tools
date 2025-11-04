/**
 * @format
 */

import '@testing-library/jest-dom';

// Mock the Office API if needed
global.Office = {
	context: {
		document: {},
	},
} as any;
