/**
 * Token-level engine: reads the model's log-probabilities directly.
 *
 * Ported from AIToolsLab/writing-prototypes `docs/engine-tokens.js`; see that
 * repo's `experiments/token-healing/README.md` for why prediction works the way
 * it does. Differences from the original:
 *
 * - Highlights skip tokens that decode to `''`. When a character is split across
 *   tokens, vLLM decodes the leading partial tokens as `''` and puts the whole
 *   character on the last one, so offsets still add up — but the original
 *   pushed a zero-width range for each empty token.
 * - Predictions keep up to {@link NUM_BRANCHES} branches, more than are shown,
 *   so the suggestion cache has survivors to fall back on as the writer types.
 *
 * The one remaining offset mismatch is Unicode normalization: Qwen's tokenizer
 * NFC-normalizes, so decomposed text (`e` + U+0301) comes back shorter than it
 * went in. Callers normalize the passage to NFC before it gets here.
 */
import {
	type ChatMessage,
	type CompletionChoice,
	isSpecialToken,
	type VllmClient,
} from '@/api/vllm';

export interface HighlightRange {
	start: number;
	end: number;
	/** The model's top choice at this position. */
	alternative: string;
	/** Log-probability gap between the top choice and what was written. */
	score: number;
	detail: string;
}

export interface HighlightsResult {
	ranges: HighlightRange[];
	tokenCount: number;
	warning: string;
}

/**
 * Treat the passage as the assistant's response to `messages`, and mark tokens
 * where the model's top choice differs, scored by how much more likely it was.
 */
export async function tokenHighlights(
	client: VllmClient,
	{ messages, passage }: { messages: ChatMessage[]; passage: string },
	signal?: AbortSignal,
): Promise<HighlightsResult> {
	const prefix = await client.turnPrefix(messages, 'assistant');
	const res = await client.completions(
		{
			prompt: prefix.text + passage,
			max_tokens: 1,
			prompt_logprobs: 5,
			return_token_ids: true,
		},
		signal,
	);
	return rangesFromPromptLogprobs(
		res.choices[0],
		prefix.ids?.length ?? 0,
		passage,
	);
}

/** The scoring half of {@link tokenHighlights}, separated for testing. */
export function rangesFromPromptLogprobs(
	choice: CompletionChoice,
	prefixLength: number,
	passage: string,
): HighlightsResult {
	const ids = choice.prompt_token_ids ?? [];
	const dists = choice.prompt_logprobs ?? [];
	const ranges: HighlightRange[] = [];
	let pos = 0;
	const docIds = ids.slice(prefixLength);
	docIds.forEach((id, j) => {
		const dist = dists[prefixLength + j];
		if (!dist) return;
		const actual = dist[String(id)];
		const top = Object.values(dist).find((e) => e.rank === 1);
		if (!actual || !top) return;
		const text = actual.decoded_token;
		const start = pos;
		pos += text.length;
		// A leading piece of a split character: the character itself rides on a
		// later token, so there's nothing here to mark.
		if (text.length === 0) return;
		const gap = top.logprob - actual.logprob; // 0 when it was the top choice
		if (gap <= 0) return;
		// Don't highlight the space before a word; it reads as marking the gap.
		const lead = text.length - text.trimStart().length;
		const ratio = Math.exp(gap);
		ranges.push({
			start: lead < text.length ? start + lead : start,
			end: pos,
			alternative: top.decoded_token,
			score: gap,
			detail: `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}× more likely`,
		});
	});
	const warning =
		pos === passage.length
			? ''
			: "The model's tokens don't line up with the text, so highlights may be misplaced.";
	return { ranges, tokenCount: docIds.length, warning };
}

// ── Predictions ─────────────────────────────────────────────────────────────

/** Branches kept per request; the server handles 8 before slowing sharply. */
export const NUM_BRANCHES = 8;

export interface Branch {
	/** Text to append to the draft the request was made for. */
	text: string;
	/** Probability of the whole path from the request's draft. */
	prob: number;
}

// Qwen's pre-tokenizer split, with the (?i:...) group expanded because not all
// browsers support inline modifiers. BPE merges never cross these boundaries,
// so typing more text can only change the tokens of the last chunk.
const PRETOKENIZE_REGEX =
	/'[sS]|'[tT]|'[rR][eE]|'[vV][eE]|'[mM]|'[lL][lL]|'[dD]|[^\r\n\p{L}\p{N}]?[\p{L}\p{M}]+|\p{N}| ?[^\s\p{L}\p{M}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;

/** Split text into [everything before the last pre-token chunk, that chunk]. */
export function splitLastPretoken(text: string): [string, string] {
	let start = text.length;
	for (const match of text.matchAll(PRETOKENIZE_REGEX)) start = match.index;
	return [text.slice(0, start), text.slice(start)];
}

/** Constrain generation to output that starts with `text`. */
function startsWith(text: string) {
	const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return { structured_outputs: { regex: `${escaped}[\\s\\S]*` } };
}

interface PendingBranch {
	forced: string;
	prob: number;
	final: string | null;
}

/**
 * Up to {@link NUM_BRANCHES} continuations of the last message in `messages`,
 * each cut at `words` words, most probable first.
 *
 * If the draft ends partway through a token ("Use de" = "Use" + " de", where
 * "deep" would be the single token " deep"), the model infers the word *isn't*
 * one with a longer token. So back up to the last pre-token boundary and
 * constrain the output to start with the backed-over text ("healed"), and in
 * parallel continue from the full draft ("unhealed") for when it ends at a
 * token boundary. Both spines' branches carry the probability of the whole
 * path from the boundary, so they're comparable. Branches that end mid-word
 * are then extended greedily in one batch to finish their words.
 *
 * `onUpdate` gets the branches as soon as the spines are back, before the
 * extension request finishes their words.
 */
export async function tokenSuggestions(
	client: VllmClient,
	{
		messages,
		words,
		onUpdate,
	}: {
		messages: ChatMessage[];
		words: number;
		onUpdate?: (branches: Branch[]) => void;
	},
	signal?: AbortSignal,
): Promise<{ branches: Branch[]; warning: string }> {
	const last = messages[messages.length - 1];
	if (!last) throw new Error('No message to continue');
	const { role, content: draft } = last;
	const [base, typed] = splitLastPretoken(draft);
	const [prefix, logitBias] = await Promise.all([
		client.turnPrefix(messages.slice(0, -1), role),
		client.noEndBias(),
	]);
	const prompt = prefix.text + base;

	const spineParams = {
		logprobs: 20,
		temperature: 0,
		logit_bias: logitBias,
		return_token_ids: true,
	};
	const [unhealedRes, healedRes] = await Promise.all([
		client.completions(
			{
				prompt: prefix.text + draft,
				max_tokens: 3,
				prompt_logprobs: 1,
				...spineParams,
			},
			signal,
		),
		typed
			? client.completions(
					{
						prompt,
						max_tokens: 3 + Math.ceil(typed.length / 4),
						...spineParams,
						...startsWith(typed),
					},
					signal,
				)
			: null,
	]);
	const unhealed = unhealedRes.choices[0];
	const healed = healedRes?.choices[0];
	const baseIds = (healed ?? unhealed).prompt_token_ids ?? [];
	const draftIds = unhealed.prompt_token_ids ?? [];
	let warning = '';
	if (!baseIds.every((id, i) => id === draftIds[i])) {
		warning =
			"Tokenization warning: this page's pre-tokenizer split doesn't match the server's, so mid-word predictions may be off.";
	} else if (healed && !healed.text.startsWith(typed)) {
		warning =
			'The server ignored the constraint to continue the partial word, so predictions may be missing.';
	}
	const promptLogprobs = unhealed.prompt_logprobs ?? [];
	const typedLogprob = draftIds
		.slice(baseIds.length)
		.reduce(
			(sum, id, j) =>
				sum +
				(promptLogprobs[baseIds.length + j]?.[String(id)]?.logprob ??
					0),
			0,
		);

	let branches = spineBranches(unhealed, typed, typed, typedLogprob);
	if (healed) branches.push(...spineBranches(healed, typed, '', 0));
	branches.sort((a, b) => b.prob - a.prob);
	// The spines overlap when the typed text is a whole token (e.g. " is").
	branches = branches.filter(
		(b, i) => branches.findIndex((c) => c.forced === b.forced) === i,
	);

	// Branches that already contain the words we'll show are final; keep the
	// most probable per shown text. The rest end mid-word and may still grow
	// into something distinct, so keep a couple extra in case they collide.
	const shown = new Set<string>();
	branches = branches
		.filter((b) => {
			b.final = completeWords(b.forced.slice(typed.length), words);
			if (b.final === null) return true;
			if (shown.has(b.final)) return false;
			shown.add(b.final);
			return true;
		})
		.slice(0, NUM_BRANCHES + 2);
	const toBranches = () =>
		uniqueBranches(
			branches.map((b) => ({
				text:
					b.final ?? firstWords(b.forced.slice(typed.length), words),
				prob: b.prob,
			})),
		);
	onUpdate?.(toBranches());

	// Each unfinished branch already contains the typed text, so no constraint.
	// Decoding gets slower per step as the batch grows; extend as few as we can.
	const unfinished = branches.filter((b) => b.final === null);
	if (unfinished.length > 0) {
		const ext = await client.completions(
			{
				prompt: unfinished.map((b) => prompt + b.forced),
				max_tokens: 2 * words,
				temperature: 0,
				logit_bias: logitBias,
			},
			signal,
		);
		for (const choice of ext.choices) {
			const b = unfinished[choice.index];
			if (b) {
				b.final = firstWords(
					(b.forced + choice.text).slice(typed.length),
					words,
				);
			}
		}
	}
	return { branches: toBranches(), warning };
}

/**
 * Branches off a spine: each top alternative at each step, appended to the
 * spine's path so far. Only ones that get past the typed text count.
 */
function spineBranches(
	choice: CompletionChoice,
	typed: string,
	pathText: string,
	pathLogprob: number,
): PendingBranch[] {
	const branches: PendingBranch[] = [];
	const lp = choice.logprobs;
	if (!lp) return branches;
	for (let j = 0; j < lp.tokens.length; j++) {
		for (const [tok, logprob] of Object.entries(lp.top_logprobs[j] ?? {})) {
			const forced = pathText + tok;
			if (
				isSpecialToken(tok) ||
				!forced.startsWith(typed) ||
				!forced.slice(typed.length).trim()
			) {
				continue;
			}
			branches.push({
				forced,
				prob: Math.exp(pathLogprob + logprob),
				final: null,
			});
		}
		pathText += lp.tokens[j];
		pathLogprob += lp.token_logprobs[j];
	}
	return branches;
}

/** The first n words of text, if text already has them followed by space. */
export function completeWords(text: string, n: number): string | null {
	const match = text.match(
		new RegExp(`^\\s*\\S+(?:[ \\t]+\\S+){${n - 1}}(?=\\s)`),
	);
	return match ? match[0] : null;
}

/** Leading whitespace plus the first n whitespace-delimited words. */
export function firstWords(text: string, n: number): string {
	const match = text.match(
		new RegExp(`^\\s*\\S+(?:[ \\t]+\\S+){0,${n - 1}}`),
	);
	return match ? match[0] : text;
}

function uniqueBranches(branches: Branch[]): Branch[] {
	return branches
		.filter(
			(b, i) =>
				b.text.trim() &&
				// A branch cut mid-character would show a replacement glyph.
				!b.text.includes('�') &&
				branches.findIndex((c) => c.text === b.text) === i,
		)
		.slice(0, NUM_BRANCHES);
}
