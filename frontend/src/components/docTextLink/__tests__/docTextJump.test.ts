import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jumpToDocText, parseDocTextHref } from '../docTextJump';

beforeEach(() => {
	// The fallback path logs each narrowed attempt; keep test output readable.
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('parseDocTextHref', () => {
	it('decodes the quoted document text', () => {
		expect(parseDocTextHref('doctext:A%20short%20quote')).toBe(
			'A short quote',
		);
	});

	it('ignores links that are not document references', () => {
		expect(parseDocTextHref('https://example.com')).toBeNull();
		expect(parseDocTextHref('#section')).toBeNull();
	});

	it('falls back to the raw target when the encoding is malformed', () => {
		// A bad escape shouldn't cost the writer the click — search it as-is.
		expect(parseDocTextHref('doctext:100% sure')).toBe('100% sure');
	});
});

describe('jumpToDocText', () => {
	/** Stands in for an editor that only knows the phrases it was given. */
	function editorThatFinds(...phrases: string[]) {
		return vi.fn((phrase: string) =>
			phrases.includes(phrase)
				? Promise.resolve()
				: Promise.reject(new Error('Phrase not found')),
		);
	}

	it('selects the quote as given when the editor finds it', async () => {
		const selectPhrase = editorThatFinds('the whole quote');

		const outcome = await jumpToDocText(selectPhrase, 'the whole quote');

		expect(outcome).toEqual({ found: true, attempts: 1 });
		expect(selectPhrase).toHaveBeenCalledExactlyOnceWith('the whole quote');
	});

	it('trims a word off each end until the quote is found', async () => {
		const selectPhrase = editorThatFinds('quote that exists');

		const outcome = await jumpToDocText(
			selectPhrase,
			'a quote that exists here',
		);

		expect(outcome).toEqual({ found: true, attempts: 2 });
		expect(selectPhrase.mock.calls.map((call) => call[0])).toEqual([
			'a quote that exists here',
			'quote that exists',
		]);
	});

	it('gives up instead of retrying the same text forever', async () => {
		const selectPhrase = editorThatFinds();

		const outcome = await jumpToDocText(selectPhrase, 'three word quote');

		// "three word quote" -> "word" -> nothing left to trim.
		expect(outcome.found).toBe(false);
		expect(selectPhrase.mock.calls.map((call) => call[0])).toEqual([
			'three word quote',
			'word',
		]);
		expect(outcome.attempts).toBe(2);
	});

	it('reports a single-word quote that is not in the document', async () => {
		const selectPhrase = editorThatFinds();

		const outcome = await jumpToDocText(selectPhrase, 'missing');

		expect(outcome).toEqual({ found: false, attempts: 1 });
	});

	it('does no work at all for an empty quote', async () => {
		const selectPhrase = editorThatFinds('');

		const outcome = await jumpToDocText(selectPhrase, '');

		expect(outcome).toEqual({ found: false, attempts: 0 });
		expect(selectPhrase).not.toHaveBeenCalled();
	});
});
