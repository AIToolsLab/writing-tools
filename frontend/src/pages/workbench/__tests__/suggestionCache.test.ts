import { describe, expect, it } from 'vitest';
import { SuggestionCache } from '../suggestionCache';

const texts = (xs: { text: string }[]) => xs.map((x) => x.text);

describe('SuggestionCache', () => {
	it('keeps a suggestion’s suffix fixed while the writer types into it', () => {
		const cache = new SuggestionCache();
		cache.setContext('k');
		cache.add('Use', [
			{ text: ' deep learning', prob: 0.5 },
			{ text: ' depleted', prob: 0.2 },
			{ text: ' care', prob: 0.1 },
		]);
		expect(texts(cache.lookup('Use de', 5))).toEqual([
			'ep learning',
			'pleted',
		]);
		expect(texts(cache.lookup('Use dee', 5))).toEqual(['p learning']);
		// Typed all of it: nothing left over to suggest.
		expect(cache.lookup('Use deep learning', 5)).toEqual([]);
		// Off every branch.
		expect(cache.lookup('Use dx', 5)).toEqual([]);
	});

	it('shows probabilities only for a request made for exactly this draft', () => {
		const cache = new SuggestionCache();
		cache.setContext('k');
		cache.add('A', [{ text: ' big dog', prob: 0.4 }]);
		expect(cache.lookup('A', 5)).toEqual([{ text: ' big dog', prob: 0.4 }]);
		expect(cache.lookup('A b', 5)).toEqual([{ text: 'ig dog' }]);
	});

	it('keeps survivors ahead of a newer request’s branches, without duplicates', () => {
		const cache = new SuggestionCache();
		cache.setContext('k');
		cache.add('The', [{ text: ' cat sat', prob: 0.3 }]);
		cache.add('The c', [
			{ text: 'ow', prob: 0.5 },
			{ text: 'at sat', prob: 0.2 },
		]);
		const got = cache.lookup('The c', 5);
		expect(texts(got)).toEqual(['at sat', 'ow']);
		expect(cache.has('The c')).toBe(true);
		expect(cache.has('The ca')).toBe(false);
	});

	it('forgets everything when the prompt changes', () => {
		const cache = new SuggestionCache();
		cache.setContext('a');
		cache.add('', [{ text: 'Hi', prob: 1 }]);
		cache.setContext('a');
		expect(cache.lookup('', 5)).toHaveLength(1);
		cache.setContext('b');
		expect(cache.lookup('', 5)).toEqual([]);
	});

	it('respects the limit', () => {
		const cache = new SuggestionCache();
		cache.setContext('k');
		cache.add(
			'',
			Array.from({ length: 8 }, (_, i) => ({ text: `w${i}`, prob: 0.1 })),
		);
		expect(cache.lookup('', 5)).toHaveLength(5);
	});
});
