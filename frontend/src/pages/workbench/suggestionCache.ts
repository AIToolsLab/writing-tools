/**
 * Predictions that hold still while the writer types into them.
 *
 * The property: typing any prefix of a prediction doesn't change that
 * prediction's suffix — the only thing a keystroke does to the suggestions on
 * screen is cull the ones it no longer matches. Re-querying on every keystroke
 * doesn't guarantee that: the engine conditions on characters, so survivors'
 * relative odds hold, but a fresh answer can rank a new unit above them or
 * drop one the search didn't reach this time. So each request's branches are
 * stored as a tree rooted at the draft it was made for, and every later draft
 * is answered from the stored trees first:
 *
 * - A branch survives while `tree.draft + branch.text` still starts with the
 *   current draft and has something left over; what's left over is shown.
 * - Survivors keep their order: older trees first, and within a tree, most
 *   probable first. A new request only fills the slots below them, and a
 *   branch it repeats keeps its earlier position.
 * - Probabilities are shown only for a tree made for exactly this draft. For a
 *   survivor from an earlier tree, the probability of the remaining suffix
 *   given what was typed isn't recoverable from what we stored.
 *
 * Anything that changes the prompt (instruction, source passage, words per
 * suggestion) invalidates every tree; callers pass it as the context key.
 */
import type { Branch } from './engine';

export interface Suggestion {
	/** Text to append to the current draft. */
	text: string;
	/** Only when the suggestion came from a request for exactly this draft. */
	prob?: number;
}

interface Tree {
	draft: string;
	branches: Branch[];
}

export class SuggestionCache {
	private contextKey: string | null = null;
	private trees: Tree[] = [];

	constructor(private readonly maxTrees = 16) {}

	/** Drop every tree if the prompt around the draft has changed. */
	setContext(key: string): void {
		if (key !== this.contextKey) {
			this.contextKey = key;
			this.trees = [];
		}
	}

	add(draft: string, branches: Branch[]): void {
		this.trees = this.trees.filter((t) => t.draft !== draft);
		this.trees.push({ draft, branches });
		if (this.trees.length > this.maxTrees) this.trees.shift();
	}

	/** Whether a request has already been answered for exactly this draft. */
	has(draft: string): boolean {
		return this.trees.some((t) => t.draft === draft);
	}

	lookup(draft: string, limit: number): Suggestion[] {
		const out: Suggestion[] = [];
		const seen = new Set<string>();
		for (const tree of this.trees) {
			if (!draft.startsWith(tree.draft)) continue;
			const exact = tree.draft === draft;
			for (const branch of tree.branches) {
				const full = tree.draft + branch.text;
				if (!full.startsWith(draft)) continue;
				const text = full.slice(draft.length);
				if (!text.trim() || seen.has(text)) continue;
				seen.add(text);
				out.push(exact ? { text, prob: branch.prob } : { text });
				if (out.length >= limit) return out;
			}
		}
		return out;
	}
}
