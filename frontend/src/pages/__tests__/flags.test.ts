import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enabledFlags, isFlagEnabled, resetFlagCache } from '../flags';

/**
 * Node environment, no jsdom (see vitest.config.ts — the suite is node-only and
 * the one existing component test uses renderToStaticMarkup to stay that way).
 * `window` and `localStorage` are stubbed per test, which also lets us reproduce
 * the sandboxed-iframe case where touching storage throws.
 */
function fakeStorage(initial: Record<string, string> = {}) {
	const entries = new Map(Object.entries(initial));
	return {
		getItem: vi.fn((key: string) => entries.get(key) ?? null),
		setItem: vi.fn((key: string, value: string) => {
			entries.set(key, value);
		}),
		removeItem: vi.fn((key: string) => {
			entries.delete(key);
		}),
		entries,
	};
}

function setSearch(search: string): void {
	vi.stubGlobal('window', { location: { search } });
}

describe('feature flags', () => {
	beforeEach(() => {
		resetFlagCache();
		vi.stubGlobal('localStorage', fakeStorage());
		setSearch('');
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('defaults to no flags', () => {
		expect(enabledFlags()).toEqual([]);
		expect(isFlagEnabled('tool-launcher')).toBe(false);
	});

	it('reads flags from the URL', () => {
		setSearch('?ff=tool-launcher');

		expect(isFlagEnabled('tool-launcher')).toBe(true);
	});

	it('accepts several comma-separated flags, ignoring stray whitespace', () => {
		setSearch('?ff=tool-launcher, my-words ,');

		expect(enabledFlags()).toEqual(['tool-launcher', 'my-words']);
	});

	it('persists a URL flag so it survives the reloads the task pane does', () => {
		const storage = fakeStorage();
		vi.stubGlobal('localStorage', storage);
		setSearch('?ff=tool-launcher');
		enabledFlags();

		// Next page load: same storage, no query string.
		resetFlagCache();
		setSearch('');

		expect(isFlagEnabled('tool-launcher')).toBe(true);
	});

	it('treats an empty ff= as a reset', () => {
		const storage = fakeStorage({ featureFlags: 'tool-launcher' });
		vi.stubGlobal('localStorage', storage);
		setSearch('?ff=');

		expect(enabledFlags()).toEqual([]);
		expect(storage.entries.has('featureFlags')).toBe(false);
	});

	it('lets the URL override a stored flag', () => {
		vi.stubGlobal(
			'localStorage',
			fakeStorage({ featureFlags: 'my-words' }),
		);
		setSearch('?ff=tool-launcher');

		expect(enabledFlags()).toEqual(['tool-launcher']);
	});

	it('resolves once per page load rather than on every lookup', () => {
		const storage = fakeStorage({ featureFlags: 'tool-launcher' });
		vi.stubGlobal('localStorage', storage);

		enabledFlags();
		enabledFlags();
		enabledFlags();

		// The navbar runs the registry's enabled predicates on every render;
		// storage must not be re-read (or rewritten) each time.
		expect(storage.getItem).toHaveBeenCalledTimes(1);
	});

	it('degrades to no flags when localStorage is unreachable', () => {
		// A sandboxed iframe without allow-same-origin throws on property access
		// rather than returning null. A flag lookup must never take the navbar
		// down with it.
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('SecurityError: sandboxed');
			},
		});

		expect(() => enabledFlags()).not.toThrow();
		expect(enabledFlags()).toEqual([]);
	});

	it('still applies a URL flag when the write to localStorage fails', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			},
			removeItem: () => {},
		});
		setSearch('?ff=tool-launcher');

		expect(isFlagEnabled('tool-launcher')).toBe(true);
	});

	it('degrades to no flags where there is no window at all', () => {
		vi.stubGlobal('window', undefined);

		expect(() => enabledFlags()).not.toThrow();
		expect(enabledFlags()).toEqual([]);
	});
});
