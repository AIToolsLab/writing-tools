import { describe, expect, it } from 'vitest';
import type { CompletionChoice, TokenLogprob } from '@/api/vllm';
import {
	completeWords,
	firstWords,
	rangesFromPromptLogprobs,
	splitLastPretoken,
} from '../engine';

const lp = (decoded: string, logprob: number, rank: number): TokenLogprob => ({
	decoded_token: decoded,
	logprob,
	rank,
});

/**
 * A prompt of [prefix token 0, then the passage's tokens], shaped like what
 * vLLM returns. Token 12 is the leading byte of a split character: vLLM
 * decodes it as '' and puts the whole character on token 13.
 */
function choice(): CompletionChoice {
	return {
		index: 0,
		text: '',
		prompt_token_ids: [0, 10, 11, 12, 13, 14],
		prompt_logprobs: [
			null,
			{ '10': lp('A', -0.1, 1) },
			// Written " big"; model preferred " large" by e^2.
			{ '11': lp(' big', -3, 3), '99': lp(' large', -1, 1) },
			{ '12': lp('', -5, 2), '98': lp(' (', -1, 1) },
			{ '13': lp(' 𝔽', -0.5, 1) },
			{ '14': lp('.', -0.2, 1) },
		],
	};
}

describe('rangesFromPromptLogprobs', () => {
	it('marks where the top choice differs and skips empty split-character tokens', () => {
		const passage = 'A big 𝔽.';
		const res = rangesFromPromptLogprobs(choice(), 1, passage);
		expect(res.warning).toBe('');
		expect(res.tokenCount).toBe(5);
		expect(res.ranges).toHaveLength(1);
		const [r] = res.ranges;
		// The leading space isn't marked.
		expect(passage.slice(r.start, r.end)).toBe('big');
		expect(r.alternative).toBe(' large');
		expect(r.detail).toBe('7.4× more likely');
	});

	it('warns when the tokens don’t add up to the passage', () => {
		const res = rangesFromPromptLogprobs(choice(), 1, 'A big 𝔽. extra');
		expect(res.warning).not.toBe('');
	});
});

describe('word helpers', () => {
	it('splits off the last pre-token chunk', () => {
		expect(splitLastPretoken('Use de')).toEqual(['Use', ' de']);
		expect(splitLastPretoken('Use ')).toEqual(['Use', ' ']);
	});

	it('finds complete words only when followed by whitespace', () => {
		expect(completeWords(' deep learning', 1)).toBe(' deep');
		expect(completeWords(' deep', 1)).toBeNull();
		expect(firstWords(' deep learning is', 2)).toBe(' deep learning');
	});
});
