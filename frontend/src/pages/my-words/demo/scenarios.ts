/**
 * One scenario, authored twice — once per interaction model — so the playback
 * videos are directly comparable. Same starting text, same three moves (tighten
 * a doubled-back opening, cut a repeated line, pull a scratchpad line in as a
 * closing). The difference is purely the commitment model:
 *
 *   - Walkthrough: each move lands as the model goes; the writer rides along.
 *   - Propose: each move waits for consent; here the writer ACCEPTS the two
 *     trims and DECLINES the added closing — so the documents end up different,
 *     which is the whole point of filming both.
 *
 * Each `modelScript` entry is consumed by one `responder.next()`, so the
 * sequence is authored to match each strategy's loop (a leading `view`, then one
 * edit per writer beat, then a closing remark).
 */

import { createProposeStrategy } from '../interaction/strategies/propose';
import { createWalkthroughStrategy } from '../interaction/strategies/walkthrough';
import type {
	AssistantMove,
	EditOp,
	InteractionStrategy,
	TurnInput,
} from '../interaction/types';

export type StrategyKey = 'walkthrough' | 'propose';

export interface WriterAction {
	/** Pause before this action, ms. */
	delayMs?: number;
	input: TurnInput;
	/** Text to show in the writer's sent-line list (for `message` inputs). */
	display?: string;
}

export interface DemoScenario {
	title: string;
	strategy: () => InteractionStrategy;
	doc: string[];
	scratchpad: string;
	modelScript: AssistantMove[];
	writerScript: WriterAction[];
}

const DOC = [
	'I want to be a nurse because I like helping people and also I have always cared about people who are sick and my grandmother was sick for a long time and I helped take care of her.',
	'Also I am good at staying calm. In emergencies I stay calm.',
];

const SCRATCHPAD =
	'the thing that matters most is being there for someone on their worst day';

const FIRST_MESSAGE = 'Can you help me tighten this? It’s all over the place.';

// The three moves, shared by both versions. Every inserted string is lifted
// verbatim from the writer's own words (document or scratchpad).
const trimOpening: EditOp = {
	kind: 'str_replace',
	oldStr: 'I like helping people and also I have always cared about people who are sick',
	newStr: 'I have always cared about people who are sick',
};
const cutRepeat: EditOp = {
	kind: 'str_replace',
	oldStr: 'Also I am good at staying calm. In emergencies I stay calm.',
	newStr: 'In emergencies I stay calm.',
};
const addClosing: EditOp = {
	kind: 'insert',
	text: 'the thing that matters most is being there for someone on their worst day',
	paragraph: 2,
	position: 'after',
};

export const SCENARIOS: Record<StrategyKey, DemoScenario> = {
	walkthrough: {
		title: 'Walkthrough — optimistic, one move at a time',
		strategy: createWalkthroughStrategy,
		doc: DOC,
		scratchpad: SCRATCHPAD,
		modelScript: [
			{ action: { tool: 'view' } },
			{
				say: 'I trimmed the doubled-back opening so it starts from what you care about. Next I’d cut the repeated “calm” line — ok?',
				action: { tool: 'edit', op: trimOpening },
			},
			{
				say: 'Cut the repeat. Now I’d pull your scratchpad line in as a closing — want it?',
				action: { tool: 'edit', op: cutRepeat },
			},
			{
				say: 'There’s an ending, in your own words. Read it over?',
				action: { tool: 'edit', op: addClosing },
			},
			{
				say: 'It reads tighter and every word is yours. Your call where to go next.',
			},
		],
		writerScript: [
			{ delayMs: 1400, input: { type: 'message', text: FIRST_MESSAGE }, display: FIRST_MESSAGE },
			{ delayMs: 2600, input: { type: 'continue' } },
			{ delayMs: 2600, input: { type: 'continue' } },
			{ delayMs: 2600, input: { type: 'continue' } },
		],
	},

	propose: {
		title: 'Propose — pessimistic, consent before each change',
		strategy: createProposeStrategy,
		doc: DOC,
		scratchpad: SCRATCHPAD,
		modelScript: [
			{ action: { tool: 'view' } },
			{
				say: 'Your opening repeats itself — may I trim it to start from “I have always cared about people who are sick”?',
				action: { tool: 'edit', op: trimOpening },
			},
			{
				say: 'These two sentences say the same thing. Cut to just “In emergencies I stay calm.”?',
				action: { tool: 'edit', op: cutRepeat },
			},
			{
				say: 'Could I bring your scratchpad line in as a closing — “…being there for someone on their worst day”?',
				action: { tool: 'edit', op: addClosing },
			},
			{
				say: 'No problem — I’ll leave the ending to you. Anything else you’d like to look at?',
			},
		],
		writerScript: [
			{ delayMs: 1400, input: { type: 'message', text: FIRST_MESSAGE }, display: FIRST_MESSAGE },
			{ delayMs: 2600, input: { type: 'accept' } },
			{ delayMs: 2600, input: { type: 'accept' } },
			{ delayMs: 2800, input: { type: 'reject' } },
		],
	},
};
