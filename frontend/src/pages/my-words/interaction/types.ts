/**
 * Shared vocabulary for the My Words interaction loop.
 *
 * The point of this layer is to make the *interaction model* — who acts, when
 * the document changes, when the floor passes back to the writer — a pluggable
 * thing we can swap and compare, rather than something baked into one big
 * `generateText` call. See docs/my-words-interaction-design.md.
 *
 * Two seams make that possible:
 *   - `Responder` — where the next move *comes from* (a live model, or a canned
 *     script for playback). Strategies never touch the AI SDK directly.
 *   - `InteractionStrategy` — what we *do* with a move: apply it now (optimistic,
 *     "walkthrough") or stage it behind a writer's consent (pessimistic,
 *     "propose"). This is the axis that actually distinguishes the approaches —
 *     the locus of commitment, not the number of steps.
 */

/** A single document operation. `move` relocates the writer's own words. */
export type EditOp =
	| {
			kind: 'str_replace';
			oldStr: string;
			newStr: string;
			/** Optional 1-based paragraph (from `view`) to scope the search to. */
			paragraph?: number;
	  }
	| {
			kind: 'insert';
			text: string;
			after?: string;
			paragraph?: number;
			position?: 'before' | 'after';
	  }
	| {
			kind: 'move';
			/** Existing text to relocate (lifted verbatim — adds no words). */
			phrase: string;
			paragraph: number;
			position?: 'before' | 'after';
	  };

/** At most one externally-visible thing the model does in a step. */
export type Action =
	| { tool: 'view' }
	| { tool: 'highlight'; phrase: string }
	| { tool: 'edit'; op: EditOp };

/**
 * One model step: an optional utterance and at most one action. A step with a
 * `say` and no `action` is pure speech (the floor passes back). Read-only
 * actions (`view`, `highlight`) don't count as commitments and the loop
 * continues; an `edit` is the move a strategy gates.
 */
export interface AssistantMove {
	say?: string;
	action?: Action;
}

/**
 * The source of the next move. Owns its own conversation memory so strategies
 * stay ignorant of message formats. `recordToolResult` feeds the outcome of an
 * action back in before the next `next()`, so the model can react to it.
 */
export interface Responder {
	/** Append the writer's turn (a real message, or a continuer like "ok"). */
	pushWriter(text: string): void;
	/** Produce the next model step. */
	next(): Promise<AssistantMove>;
	/** Report what just happened after the strategy ran the last action. */
	recordToolResult(text: string): void;
}

/** A document edit staged for the writer's explicit consent (Propose). */
export interface PendingProposal {
	op: EditOp;
	/** One-line, human-readable description of what would change. */
	summary: string;
	/** The model's accompanying utterance ("May I move this up?"). */
	say: string;
}

/** What the writer can do next, which the UI uses to render affordances. */
export type Awaiting =
	| 'message' // open floor: type anything
	| 'continue' // a move is teed up: Enter / "ok" carries it out
	| 'decision'; // a proposal is staged: accept or reject

/** What a strategy reports back to the component after yielding the floor. */
export interface TurnResult {
	caption: string;
	awaiting: Awaiting;
	pending?: PendingProposal | null;
}

/** A signal from the writer that drives the next turn. */
export type TurnInput =
	| { type: 'message'; text: string }
	| { type: 'continue' } // Enter / "ok, go on"
	| { type: 'accept' } // accept the staged proposal
	| { type: 'reject' }; // decline the staged proposal

/** Everything a strategy needs to run a turn, without owning React state. */
export interface StrategyContext {
	editor: EditorAPI;
	responder: Responder;
	/** Build the live word-bank to validate edits against. */
	corpus: () => Promise<import('../corpus').Corpus>;
	/** Push an interim caption mid-turn (feedthrough while acting). */
	setCaption: (text: string) => void;
}

/**
 * An interaction model. `run` advances one turn from a writer signal, mutates
 * the document through the editor as appropriate, and resolves when it yields
 * the floor. A strategy instance may hold state between calls (e.g. Propose's
 * staged proposal awaiting an accept/reject).
 */
export interface InteractionStrategy {
	readonly name: string;
	readonly blurb: string;
	run(input: TurnInput, ctx: StrategyContext): Promise<TurnResult>;
}
