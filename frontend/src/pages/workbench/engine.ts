/**
 * Token-level engine: reads the model's probabilities from the writing engine
 * (`@/api/writingEngine`).
 *
 * Ported from AIToolsLab/writing-prototypes `docs/engine-tokens.js`. The
 * server conditions on the draft's characters, so there's no token healing
 * here; this file turns scores into highlight ranges, groups continuations
 * into the units shown (words, see `words.ts`), and picks out corrections.
 */
import type {
	ChatMessage,
	Continuation,
	EngineClient,
	ScoredToken,
} from '@/api/writingEngine';
import {
	firstUnits,
	NO_SPACE_SCRIPT,
	spellingDistance,
	wordUnitPattern,
} from './words';

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

export const NUM_SUGGESTIONS = 5;

/** Corrections shown at most, ahead of the completions. */
const MAX_CORRECTIONS = 2;

export interface Suggestion {
	/** Text to put at the end of the draft (after removing `correction.replace`). */
	text: string;
	/**
	 * P(the reply continues with this | the draft), summed over the
	 * continuations that start with it. A lower bound: the server drops
	 * branches too unlikely to follow. Absent for corrections.
	 */
	prob?: number;
	correction?: {
		/** Characters at the end of the draft that `text` replaces. */
		replace: number;
		/** The word it makes. */
		word: string;
		/** How many times as likely as everything that keeps what was typed. */
		ratio: number;
	};
}

/**
 * Group continuations by the unit they start with, adding up their
 * probabilities (continuations are disjoint). Whole units come first; partial
 * ones (the server stopped partway) only fill slots that would otherwise be
 * empty.
 */
export function unitSuggestions(
	continuations: Continuation[],
	words: number,
): Suggestion[] {
	const units = new Map<
		string,
		{ text: string; prob: number; complete: boolean }
	>();
	for (const { text, prob, done, end } of continuations) {
		// Ending the turn ends the word too.
		const unit = firstUnits(end ? `${text} ` : text, words);
		// Ending the message isn't a suggestion, and a unit cut mid-character
		// would show a replacement glyph.
		if (!unit.text.trim() || unit.text.includes('�')) continue;
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
		.slice(0, NUM_SUGGESTIONS)
		.map(({ text, prob }) => ({ text, prob }));
}

/**
 * The continuations still possible after typing `extra` more characters.
 * Their new probabilities are lower bounds: continuations we never saw might
 * match `extra` too.
 */
export function narrow(
	continuations: Continuation[],
	extra: string,
): Continuation[] {
	const kept = continuations.filter((c) => !c.replace);
	const matching = kept.filter(
		(c) => c.text.length > extra.length && c.text.startsWith(extra),
	);
	const seen = kept.reduce((sum, c) => sum + c.prob, 0);
	const total =
		matching.reduce((sum, c) => sum + c.prob, 0) + Math.max(0, 1 - seen);
	return matching.map((c) => ({
		...c,
		text: c.text.slice(extra.length),
		prob: c.prob / total,
	}));
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder();

/**
 * Suggestions that replace the end of the draft (the server's corrections),
 * when the model finds one at least as likely as everything that keeps what
 * was typed, and it's spelled close to the word being typed: at most 1 edit
 * for short words, 2 otherwise, ignoring case (so iphone → iPhone is free),
 * and comparing a word still being typed with the start of the correction.
 * Only for words of 3 or more characters, keeping the first letter, and
 * within 100× of the best correction.
 */
export function correctionSuggestions(
	draft: string,
	continuations: Continuation[],
	words: number,
): Suggestion[] {
	const typedWord = /\S*$/.exec(draft.trimEnd())?.[0] ?? '';
	if (typedWord.length < 3) return [];
	const space = /\s*$/.exec(draft)?.[0] ?? '';
	const bytes = utf8.encode(draft);
	const found = new Map<
		string,
		Suggestion & { correction: NonNullable<Suggestion['correction']> }
	>();
	for (const { text, prob, end, replace } of continuations) {
		if (!replace || prob < 1) continue;
		const unit = firstUnits(end ? `${text} ` : text, words);
		if (!unit.complete || !unit.text.trim()) continue;
		// The server counts bytes.
		const kept = fromUtf8.decode(bytes.slice(0, bytes.length - replace));
		const removed = draft.slice(kept.length);
		const word = /\S*$/.exec(kept + unit.text)?.[0] ?? '';
		const atWordEnd = /\s$/.test(removed) || words > 1;
		const close =
			spellingDistance(
				typedWord.toLowerCase(),
				word.toLowerCase(),
				!atWordEnd,
			) <= (typedWord.length <= 4 ? 1 : 2);
		if (
			!close ||
			word === typedWord ||
			word[0]?.toLowerCase() !== typedWord[0].toLowerCase()
		) {
			continue;
		}
		// An odd tokenization that doubles a space.
		if (/\s$/.test(kept) && /^\s/.test(unit.text)) continue;
		// Keep the space the writer typed after the word.
		const insert =
			unit.text +
			(/\s$/.test(removed) && !/\s$/.test(unit.text) ? space : '');
		const key = kept + insert; // different paths to the same result add up
		const c = found.get(key) ?? {
			text: insert,
			correction: { replace: removed.length, word, ratio: 0 },
		};
		c.correction.ratio += prob;
		found.set(key, c);
	}
	const sorted = [...found.values()].sort(
		(a, b) => b.correction.ratio - a.correction.ratio,
	);
	// A second misspelling ("learing" for "lerning") can beat the typed word
	// too; keep near-best ones only.
	return sorted
		.filter((c) => c.correction.ratio >= sorted[0].correction.ratio / 100)
		.slice(0, MAX_CORRECTIONS);
}

interface Answer {
	context: string;
	draft: string;
	continuations: Continuation[];
}

/**
 * Next-word suggestions for one view: completions, plus corrections of the
 * word being typed. Keeps the last answer, to narrow it locally while the next
 * request is out, and the last corrections, because the server only
 * reconsiders the word being typed: once a space follows it, the corrections
 * it had for the word carry over (with the space).
 */
export class Predictor {
	private last: Answer | null = null;
	private lastCorrections: {
		context: string;
		draft: string;
		items: Suggestion[];
	} | null = null;

	constructor(private readonly client: EngineClient) {}

	async suggest(
		{
			messages,
			words,
			onUpdate,
		}: {
			messages: ChatMessage[];
			words: number;
			onUpdate?: (suggestions: Suggestion[]) => void;
		},
		signal?: AbortSignal,
	): Promise<{
		suggestions: Suggestion[];
		warning: string;
		serverMs: number;
	}> {
		const last = messages[messages.length - 1];
		if (!last) throw new Error('No message to continue');
		const { role, content: draft } = last;
		const prompt = await this.client.turnPrefix(
			messages.slice(0, -1),
			role,
		);
		const context = JSON.stringify([prompt, words]);

		// Until the server answers, show what the last answer implies for the
		// characters typed since.
		const prev = this.last;
		if (
			prev &&
			prev.context === context &&
			draft.length > prev.draft.length &&
			draft.startsWith(prev.draft)
		) {
			const local = unitSuggestions(
				narrow(prev.continuations, draft.slice(prev.draft.length)),
				words,
			);
			if (local.length) onUpdate?.(local);
		}

		const recent = messages
			.map((m) => m.content)
			.join('\n')
			.slice(-200);
		const res = await this.client.continuations(
			{
				prompt,
				text: draft,
				units: NUM_SUGGESTIONS,
				corrections: 1,
				time_ms: 150,
				stop: wordUnitPattern(words),
				...(NO_SPACE_SCRIPT.test(recent)
					? { max_chars: 4 * words + 2 }
					: {}),
			},
			signal,
		);
		this.last = { context, draft, continuations: res.continuations };

		let corrections = correctionSuggestions(
			draft,
			res.continuations,
			words,
		);
		if (corrections.length) {
			this.lastCorrections = { context, draft, items: corrections };
		} else {
			corrections = this.carriedCorrections(context, draft);
			if (!/\s$/.test(draft) && !corrections.length) {
				this.lastCorrections = { context, draft, items: [] };
			}
		}
		const completions = unitSuggestions(
			res.continuations.filter((c) => !c.replace),
			words,
		);
		return {
			suggestions: [...corrections, ...completions].slice(
				0,
				NUM_SUGGESTIONS,
			),
			warning:
				res.unresolved > 0.05
					? "Some ways of reading the last word weren't explored, so probabilities may be a little high."
					: '',
			serverMs: Math.round(res.stats.total_ms),
		};
	}

	/** The last word's corrections, once only whitespace has been typed after it. */
	private carriedCorrections(context: string, draft: string): Suggestion[] {
		const prev = this.lastCorrections;
		if (!prev || prev.context !== context) return [];
		const space = draft.slice(prev.draft.length);
		if (!draft.startsWith(prev.draft) || !/^\s+$/.test(space)) return [];
		return prev.items.flatMap((c) =>
			c.correction
				? [
						{
							text: /\s$/.test(c.text) ? c.text : c.text + space,
							correction: {
								...c.correction,
								replace: c.correction.replace + space.length,
							},
						},
					]
				: [],
		);
	}
}
