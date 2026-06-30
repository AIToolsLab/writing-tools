import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToken, loadToken, persistToken } from '../authTokenStore';

// Minimal in-memory localStorage stub so the store can be tested in the node
// environment (no jsdom dependency).
function makeStorage() {
	const map = new Map<string, string>();
	return {
		getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
		setItem: (k: string, v: string) => {
			map.set(k, v);
		},
		removeItem: (k: string) => {
			map.delete(k);
		},
		clear: () => map.clear(),
	};
}

beforeEach(() => {
	vi.stubGlobal('localStorage', makeStorage());
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('authTokenStore', () => {
	it('persists and loads a token round-trip', () => {
		expect(loadToken()).toBeNull();
		persistToken('tok-123');
		expect(loadToken()).toBe('tok-123');
	});

	it('clears the token', () => {
		persistToken('tok-123');
		clearToken();
		expect(loadToken()).toBeNull();
	});

	it('degrades gracefully when setItem throws (no token persisted)', () => {
		vi.stubGlobal('localStorage', {
			...makeStorage(),
			setItem: () => {
				throw new Error('storage disabled');
			},
		});
		expect(() => persistToken('tok-123')).not.toThrow();
	});

	it('returns null when getItem throws', () => {
		vi.stubGlobal('localStorage', {
			...makeStorage(),
			getItem: () => {
				throw new Error('storage disabled');
			},
		});
		expect(loadToken()).toBeNull();
	});

	it('does not throw when removeItem throws', () => {
		vi.stubGlobal('localStorage', {
			...makeStorage(),
			removeItem: () => {
				throw new Error('storage disabled');
			},
		});
		expect(() => clearToken()).not.toThrow();
	});
});
