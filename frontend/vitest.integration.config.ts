import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config';

// Separate from browser-unit tests: both packages must have dependencies installed.
export default defineConfig({
	...unitConfig,
	test: { ...unitConfig.test, include: ['integration/*.test.mjs'] },
});
