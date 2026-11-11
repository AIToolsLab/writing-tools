/**
 * Token-level engine: reads the model's probabilities from the writing engine
 * (`@/api/writingEngine`).
 *
 * Ported from AIToolsLab/writing-prototypes `docs/engine-tokens.js`. The
 * server conditions on the draft's characters, so there's no token healing
 * here; this file turns scores into highlight ranges and groups continuations
 * into the units shown (words). Differences from the original:
 *
 * - Predictions keep up to {@link NUM_BRANCHES} units, more than are shown, so
 *   the suggestion cache has survivors to fall back on as the writer types.
 * - There's no local narrowing of the last answer while the next is on its
 *   way; the suggestion cache does that job.
 */
import type {
	ChatMessage,
	Continuation,
	EngineClient,
	ScoredToken,
} from '@/api/writingEngine';

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
	serverMs: number;
}

/**
 * Treat the passage as the assistant's response to `messages`, and mark tokens
 * where the model's top choice differs, scored by how much more likely it was.
 */
export async function tokenHighlights(
	client: EngineClient,
	{ messages, passage }: { messages: ChatMessage[]; passage: string },
	signal?: AbortSignal,
): Promise<HighlightsResult> {
	const prompt = await client.turnPrefix(messages, 'assistant');
	const res = await client.score({ prompt, text: passage }, signal);
	return {
		...rangesFromScores(res.tokens, passage),
		tokenCount: res.stats.text_tokens,
		serverMs: Math.round(res.stats.total_ms),
	};
}

/** The scoring half of {@link tokenHighlights}, separated for testing. */
export function rangesFromScores(
	tokens: ScoredToken[],
	passage: string,
): { ranges: HighlightRange[]; warning: string } {
	const ranges: HighlightRange[] = [];
	let pos = 0;
	for (const { text, logprob, top, top_logprob } of tokens) {
		const start = pos;
		pos += text.length;
		const gap = top_logprob - logprob; // 0 when it was the top choice
		if (gap <= 0 || text.length === 0) continue;
		// Don't highlight the space before a word; it reads as marking the gap.
		const lead = text.length - text.trimStart().length;
		const ratio = Math.exp(gap);
		ranges.push({
			start: lead < text.length ? start + lead : start,
			end: pos,
			alternative: top,
			score: gap,
			detail: `${ratio < 10 ? ratio.toFixed(1) : Math.round(ratio)}× more likely`,
		});
	}
	const warning =
		pos === passage.length
			? ''
			: "The model's tokens don't line up with the text, so highlights may be misplaced.";
	return { ranges, warning };
}

// ── Predictions ─────────────────────────────────────────────────────────────

/** Units kept per request: more than are shown, for the suggestion cache. */
export const NUM_BRANCHES = 8;

export interface Branch {
	/** Text to append to the draft the request was made for. */
	text: string;
	/**
	 * P(the reply continues with this unit | the draft), summed over the
	 * continuations that start with it. A lower bound: the server drops
	 * branches too unlikely to follow.
	 */
	prob: number;
}

// Scripts written without spaces between words. For these, words come from
// the browser's segmenter, and the server is asked for a few characters
// rather than "up to the next space".
const NO_SPACE_SCRIPT =
	/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const segmenter =
	typeof Intl !== 'undefined' && Intl.Segmenter
		? new Intl.Segmenter(undefined, { granularity: 'word' })
		: null;

/**
 * Up to {@link NUM_BRANCHES} continuations of the last message in `messages`,
 * each cut at `words` words, most probable first.
 */
export async function tokenSuggestions(
	client: EngineClient,
	{ messages, words }: { messages: ChatMessage[]; words: number },
	signal?: AbortSignal,
): Promise<{ branches: Branch[]; warning: string; serverMs: number }> {
	const last = messages[messages.length - 1];
	if (!last) throw new Error('No message to continue');
	const { role, content: draft } = last;
	const prompt = await client.turnPrefix(messages.slice(0, -1), role);
	const recent = messages
		.map((m) => m.content)
		.join('\n')
		.slice(-200);
	const res = await client.continuations(
		{
			prompt,
			text: draft,
			units: NUM_BRANCHES,
			stop: `^\\s*\\S+(?:[ \\t]+\\S+){${words - 1}}(?=\\s)`,
			...(NO_SPACE_SCRIPT.test(recent)
				? { max_chars: 4 * words + 2 }
				: {}),
		},
		signal,
	);
	return {
		branches: unitBranches(res.continuations, words),
		warning:
			res.unresolved > 0.05
				? "Some ways of reading the last word weren't explored, so probabilities may be a little high."
				: '',
		serverMs: Math.round(res.stats.total_ms),
	};
}

/**
 * Group continuations by the unit they start with, adding up their
 * probabilities (continuations are disjoint). Whole units come first; partial
 * ones (the server stopped partway) only fill slots that would otherwise be
 * empty.
 */
export function unitBranches(
	continuations: Continuation[],
	words: number,
): Branch[] {
	const units = new Map<string, Branch & { complete: boolean }>();
	for (const { text, prob, done } of continuations) {
		const unit = firstUnits(text, words);
		// Ending the message isn't a suggestion, and a unit cut mid-character
		// would show a replacement glyph.
		if (!unit.text.trim() || unit.text.includes('\uFFFD')) continue;
		const u = units.get(unit.text) ?? {
			text: unit.text,
			prob: 0,
			complete: false,
		};
		u.prob += prob;
		u.complete ||= unit.complete || done;
		units.set(unit.text, u);
	}
	return [...units.values()]
		.sort(
			(a, b) =>
				Number(b.complete) - Number(a.complete) || b.prob - a.prob,
		)
		.slice(0, NUM_BRANCHES)
		.map(({ text, prob }) => ({ text, prob }));
}

/**
 * The first n words of a continuation, and whether there's enough text after
 * them to know they're whole.
 */
export function firstUnits(
	text: string,
	n: number,
): { text: string; complete: boolean } {
	if (!segmenter || !NO_SPACE_SCRIPT.test(text)) {
		const whole = completeWords(text, n);
		return whole === null
			? { text: firstWords(text, n), complete: false }
			: { text: whole, complete: true };
	}
	// A unit is a word plus any punctuation after it; it ends at whitespace or
	// where the next word starts.
	const segments = [...segmenter.segment(text)];
	let count = 0;
	let end = 0;
	let i = 0;
	for (; i < segments.length; i++) {
		const { segment, isWordLike } = segments[i];
		if (count === n && (isWordLike || /\s/.test(segment))) break;
		if (isWordLike) count++;
		end = segments[i].index + segment.length;
	}
	// The last segment may be a word that's still growing, so it doesn't
	// confirm that the unit ended.
	const complete =
		count === n &&
		(i < segments.length - 1 ||
			(i < segments.length && /\s/.test(segments[i].segment)));
	return { text: text.slice(0, end), complete };
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
