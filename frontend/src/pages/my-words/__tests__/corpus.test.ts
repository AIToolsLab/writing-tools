import { describe, expect, it } from 'vitest';

import { buildCorpus, GLUE_WORDS, validateText } from '../corpus';

const corpusOf = (text: string) => buildCorpus({ docText: text });

describe('buildCorpus', () => {
	it('collects words from all sources, dropping punctuation', () => {
		const corpus = buildCorpus({
			docText: 'The cat sat.',
			scratchpad: 'a quiet morning',
			userMessages: ['I like dogs too'],
		});
		expect(corpus.wordSet.has('cat')).toBe(true);
		expect(corpus.wordSet.has('morning')).toBe(true);
		expect(corpus.wordSet.has('dogs')).toBe(true);
		expect(corpus.wordSet.has('.')).toBe(false);
	});

	it('does not let phrases span across separate sources', () => {
		// "sat" ends docText and "dog" begins scratchpad; their adjacency is an
		// artifact of concatenation and must not count as a corpus phrase.
		const corpus = buildCorpus({ docText: 'cat sat', scratchpad: 'dog run' });
		expect(validateText('cat sat', corpus).ok).toBe(true);
		expect(validateText('sat dog', corpus).ok).toBe(false);
	});
});

describe('validateText — phrase-level rule', () => {
	it('accepts a verbatim phrase lifted from the corpus', () => {
		const corpus = corpusOf('The quick brown fox jumped over the lazy dog.');
		expect(validateText('the quick brown fox', corpus).ok).toBe(true);
		expect(validateText('lazy dog', corpus).ok).toBe(true);
	});

	it('accepts two corpus phrases bridged by a glue word', () => {
		const corpus = corpusOf('I value honesty. I also value hard work.');
		// "honesty" and "hard work" are both in the corpus, bridged by "and".
		expect(validateText('honesty and hard work', corpus).ok).toBe(true);
	});

	it('accepts punctuation inserted freely between lifted content', () => {
		const corpus = corpusOf('honesty hard work');
		expect(validateText('honesty, hard work', corpus).ok).toBe(true);
		expect(validateText('honesty: hard work!', corpus).ok).toBe(true);
	});

	it('rejects a new adjacency of two corpus words with no bridge', () => {
		// "big" and "dog" both appear, but never adjacent and not glue-bridged.
		const corpus = corpusOf('the big cat and the small dog');
		expect(validateText('big dog', corpus).ok).toBe(false);
		// The glue-bridged version is allowed.
		expect(validateText('big and dog', corpus).ok).toBe(true);
	});

	it('rejects a multi-word run that is not contiguous in the corpus', () => {
		// Each bigram exists ("a b", "b c") but the trigram "a b c" never does.
		const corpus = corpusOf('alpha beta. beta gamma.');
		expect(validateText('alpha beta', corpus).ok).toBe(true);
		expect(validateText('beta gamma', corpus).ok).toBe(true);
		expect(validateText('alpha beta gamma', corpus).ok).toBe(false);
	});

	it('rejects a novel content word the writer never used', () => {
		const corpus = corpusOf('I enjoy writing essays.');
		const result = validateText('I enjoy painting', corpus);
		expect(result.ok).toBe(false);
		expect(result.offending).toContain('painting');
	});

	it('allows a punctuation-only / glue-only edit', () => {
		const corpus = corpusOf('anything at all');
		expect(validateText('.', corpus).ok).toBe(true);
		expect(validateText('and', corpus).ok).toBe(true);
		expect(validateText(' , ; — ', corpus).ok).toBe(true);
	});

	it('is case-insensitive when matching', () => {
		const corpus = corpusOf('Reproducible Research Matters');
		expect(validateText('reproducible research', corpus).ok).toBe(true);
		expect(validateText('REPRODUCIBLE RESEARCH', corpus).ok).toBe(true);
	});

	it('matches words with internal apostrophes and straightens curly quotes', () => {
		const corpus = corpusOf("I don't think that's wise");
		expect(validateText("don't", corpus).ok).toBe(true);
		// curly apostrophe in the proposed text should still match.
		expect(validateText('don’t', corpus).ok).toBe(true);
	});

	it('reports a segmentation that labels lifted / glue / punct parts', () => {
		const corpus = corpusOf('honesty hard work');
		const result = validateText('honesty and hard work, please', corpus);
		// "please" is novel content => not ok.
		expect(result.ok).toBe(false);
		const kinds = result.segments.map((s) => s.kind);
		expect(kinds).toContain('lifted');
		expect(kinds).toContain('glue');
		expect(kinds).toContain('punct');
	});

	it('treats an empty proposal as trivially valid', () => {
		const corpus = corpusOf('whatever');
		expect(validateText('', corpus).ok).toBe(true);
	});
});

describe('GLUE_WORDS', () => {
	it('includes basic articles/conjunctions but excludes content connectives', () => {
		expect(GLUE_WORDS.has('and')).toBe(true);
		expect(GLUE_WORDS.has('the')).toBe(true);
		expect(GLUE_WORDS.has('because')).toBe(false);
		expect(GLUE_WORDS.has('however')).toBe(false);
	});
});
