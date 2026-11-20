/**
 * Token → dollars. Applied at read time by the usage summary, never stored: rates
 * change and get corrected, and re-pricing history from stored token counts is
 * cheap, whereas a wrong dollar figure baked into a row at request time is stuck
 * there.
 *
 * RATES MUST BE VERIFIED AND EXTENDED BY HAND against the provider's price list
 * (https://openai.com/api/pricing) — nothing here checks them. A model that isn't
 * in the table is reported as `unpriced` rather than being silently costed at $0,
 * so switching models makes the gap visible in the summary instead of quietly
 * under-reporting spend.
 *
 * Last verified: 2026-07-13 (gpt-4o*, gpt-5.6-terra); gpt-6-luna and gpt-6.2-sol
 * added 2026-11-20 from the rates on OpenAI's pricing page.
 *
 * This table is also the proxy's model allowlist (see isPricedModel): a request
 * for a model with no rate here is refused, so every dollar spent through the
 * proxy can be counted.
 */

/**
 * USD per 1M tokens. `cachedInput` is the discounted rate for cache hits (reads).
 * `cacheWrite30m` / `cacheWrite12h` are charged for prompt tokens *written* to the
 * cache, by retention; models that don't charge for writes omit them, and their
 * writes are billed as ordinary input.
 */
interface Rate {
	input: number;
	cachedInput: number;
	output: number;
	cacheWrite30m?: number;
	cacheWrite12h?: number;
}

// Keyed by model prefix, so dated snapshots (gpt-4o-2024-08-06) inherit the base
// model's rate. Longest matching prefix wins, so gpt-4o-mini beats gpt-4o.
const RATES: Record<string, Rate> = {
	'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10.0 },
	'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
	'gpt-5.6-terra': { input: 2.5, cachedInput: 0.25, output: 15.0 },
	'gpt-6-luna': {
		input: 0.1,
		cachedInput: 0.01,
		output: 0.5,
		cacheWrite30m: 0.125,
		cacheWrite12h: 0.25,
	},
	'gpt-6.2-sol': {
		input: 2.0,
		cachedInput: 0.1,
		output: 10.0,
		cacheWrite30m: 2.5,
		cacheWrite12h: 5.0,
	},
};

function rateFor(model: string): Rate | null {
	let best: { prefix: string; rate: Rate } | null = null;
	for (const [prefix, rate] of Object.entries(RATES)) {
		if (!model.startsWith(prefix)) continue;
		if (!best || prefix.length > best.prefix.length) best = { prefix, rate };
	}
	return best?.rate ?? null;
}

/**
 * Whether the proxy may serve this model: only models we can price. Matches the
 * same way costUsd does, so a dated snapshot of a listed model is allowed.
 */
export function isPricedModel(model: string): boolean {
	return rateFor(model) !== null;
}

export interface TokenCounts {
	model: string;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
	/**
	 * Prompt tokens written to the cache — a subset of `inputTokens`, disjoint from
	 * `cachedInputTokens` (reads). Optional: older rows and models that don't
	 * report writes have none.
	 */
	cacheWriteTokens?: number;
	/**
	 * The part of `cacheWriteTokens` known to be 30-minute writes. The remainder is
	 * priced at the 12-hour rate: when the response doesn't break writes down by
	 * retention, we assume the more expensive one, erring toward over-counting.
	 */
	cacheWrite30mTokens?: number;
}

/**
 * Cost in USD, or null if the model has no rate in the table.
 *
 * Cached input tokens are a subset of input tokens in OpenAI's accounting, so the
 * uncached remainder is billed at the full rate and the cached portion at the
 * discounted one. Cache writes are a further subset of input ("input tokens that
 * were written to the cache", per the ResponseUsage reference), disjoint from reads
 * (a token in one request is either retrieved from the cache or written to it), so
 * each input token is exactly one of ordinary, cache read, or cache write.
 * Reasoning tokens are likewise already counted inside output tokens, so they are
 * not billed again here.
 */
export function costUsd(counts: TokenCounts): number | null {
	const rate = rateFor(counts.model);
	if (!rate) return null;

	const cached = Math.min(counts.cachedInputTokens, counts.inputTokens);
	const writes = Math.min(counts.cacheWriteTokens ?? 0, counts.inputTokens - cached);
	const writes30m = Math.min(counts.cacheWrite30mTokens ?? 0, writes);
	const writes12h = writes - writes30m;
	const uncached = counts.inputTokens - cached - writes;
	return (
		(uncached * rate.input +
			cached * rate.cachedInput +
			writes30m * (rate.cacheWrite30m ?? rate.input) +
			writes12h * (rate.cacheWrite12h ?? rate.input) +
			counts.outputTokens * rate.output) /
		1_000_000
	);
}

