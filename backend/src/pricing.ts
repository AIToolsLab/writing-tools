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
 * Last verified: 2026-07-13.
 */

/** USD per 1M tokens. `cachedInput` is the discounted rate for cache hits. */
interface Rate {
	input: number;
	cachedInput: number;
	output: number;
}

// Keyed by model prefix, so dated snapshots (gpt-4o-2024-08-06) inherit the base
// model's rate. Longest matching prefix wins, so gpt-4o-mini beats gpt-4o.
const RATES: Record<string, Rate> = {
	'gpt-4o': { input: 2.5, cachedInput: 1.25, output: 10.0 },
	'gpt-4o-mini': { input: 0.15, cachedInput: 0.075, output: 0.6 },
	'gpt-5.6-terra': { input: 2.5, cachedInput: 0.25, output: 15.0 },
};

function rateFor(model: string): Rate | null {
	let best: { prefix: string; rate: Rate } | null = null;
	for (const [prefix, rate] of Object.entries(RATES)) {
		if (!model.startsWith(prefix)) continue;
		if (!best || prefix.length > best.prefix.length) best = { prefix, rate };
	}
	return best?.rate ?? null;
}

export interface TokenCounts {
	model: string;
	inputTokens: number;
	cachedInputTokens: number;
	outputTokens: number;
}

/**
 * Cost in USD, or null if the model has no rate in the table.
 *
 * Cached input tokens are a subset of input tokens in OpenAI's accounting, so the
 * uncached remainder is billed at the full rate and the cached portion at the
 * discounted one. Reasoning tokens are likewise already counted inside output
 * tokens, so they are not billed again here.
 */
export function costUsd(counts: TokenCounts): number | null {
	const rate = rateFor(counts.model);
	if (!rate) return null;

	const cached = Math.min(counts.cachedInputTokens, counts.inputTokens);
	const uncached = counts.inputTokens - cached;
	return (
		(uncached * rate.input +
			cached * rate.cachedInput +
			counts.outputTokens * rate.output) /
		1_000_000
	);
}
