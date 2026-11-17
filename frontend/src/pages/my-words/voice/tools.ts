/**
 * The six editor tools the voice partner may call, as JSON Schema.
 *
 * Ported from the retired Python worker's `@function_tool` decorators
 * (voice-agent/agent.py, deleted) — the descriptions were the model's only
 * guidance on paragraph targeting and the newline-is-a-paragraph-break rule, so
 * they're carried over near-verbatim rather than trimmed.
 *
 * Schemas and dispatch are built together (`buildVoiceTools`) so a schema can't
 * exist without a handler behind it, or vice versa.
 */

import type { VoiceTool } from './transport';

export const TOOL_NAMES = [
	'view',
	'str_replace',
	'insert',
	'move',
	'highlight',
	'undo',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** Dispatch a call by name. Returns the string the model reads; never throws. */
export type ToolDispatch = (
	name: ToolName,
	args: Record<string, unknown>,
) => Promise<string>;

const TARGET = {
	type: 'string',
	enum: ['document', 'scratchpad'],
	description: "'document' (default) or 'scratchpad'.",
} as const;

/** JSON Schema per tool, keyed by name. */
const SCHEMAS: Record<
	ToolName,
	{ description: string; parameters: Record<string, unknown> }
> = {
	view: {
		description:
			'Read the current document (or scratchpad), paragraphs numbered like [3]. ' +
			'Call this to re-read before an edit when paragraph numbers may have ' +
			'shifted. The numbers are for targeting insert/move; never say them aloud.',
		parameters: {
			type: 'object',
			properties: {
				target: TARGET,
				around: {
					type: 'integer',
					description:
						'Optional paragraph number — return just a short window around it ' +
						'instead of the whole text.',
				},
			},
			required: [],
		},
	},
	str_replace: {
		description:
			'Replace a SHORT span (a phrase or sentence within one paragraph). The ' +
			"replacement must be lifted from the writer's own words. Pass `paragraph` " +
			'(the [n] from view) to scope the search there — more reliable than a bare ' +
			'search. A newline in new_str splits the paragraph; a newline in old_str ' +
			'matches across a paragraph boundary (which is how you join two paragraphs).',
		parameters: {
			type: 'object',
			properties: {
				old_str: {
					type: 'string',
					description: 'The exact existing text to replace.',
				},
				new_str: {
					type: 'string',
					description:
						"The replacement, drawn from the writer's words.",
				},
				paragraph: {
					type: 'integer',
					description:
						'1-based paragraph number from view to scope to.',
				},
				target: TARGET,
			},
			required: ['old_str', 'new_str'],
		},
	},
	insert: {
		description:
			"Insert text lifted from the writer's words. Pass `paragraph` + `position` " +
			'to place a new paragraph relative to an existing one, `after` to insert ' +
			'within a paragraph, or neither to append at the end. A newline in `text` ' +
			'starts another new paragraph.',
		parameters: {
			type: 'object',
			properties: {
				text: {
					type: 'string',
					description:
						"The text to insert, drawn from the writer's words.",
				},
				after: {
					type: 'string',
					description:
						'Insert right after this existing text (within a paragraph).',
				},
				paragraph: {
					type: 'integer',
					description:
						'1-based paragraph number from view to position against.',
				},
				position: {
					type: 'string',
					enum: ['before', 'after'],
					description:
						"'before' or 'after' the target paragraph. Defaults to after.",
				},
				target: TARGET,
			},
			required: ['text'],
		},
	},
	move: {
		description:
			"Relocate an existing passage (the writer's own words) elsewhere. Adds no " +
			"words — it moves what's already there.",
		parameters: {
			type: 'object',
			properties: {
				phrase: {
					type: 'string',
					description: 'The exact existing passage to relocate.',
				},
				paragraph: {
					type: 'integer',
					description: '1-based paragraph number to move it next to.',
				},
				position: {
					type: 'string',
					enum: ['before', 'after'],
					description:
						"'before' or 'after' the target paragraph. Defaults to after.",
				},
				target: TARGET,
			},
			required: ['phrase', 'paragraph'],
		},
	},
	highlight: {
		description:
			'Point at a passage while you talk about it (selects/highlights it).',
		parameters: {
			type: 'object',
			properties: {
				phrase: {
					type: 'string',
					description: 'The exact existing text to highlight.',
				},
				target: TARGET,
			},
			required: ['phrase'],
		},
	},
	undo: {
		description:
			'Revert your most recent edit (document or scratchpad). Use it freely when ' +
			'the writer hesitates or objects — edits are meant to be tentative. ' +
			'Undoing something the writer has since hand-edited is refused rather than ' +
			'guessed at.',
		parameters: { type: 'object', properties: {}, required: [] },
	},
};

/** The full tool list, each schema wired to `dispatch`. */
export function buildVoiceTools(dispatch: ToolDispatch): VoiceTool[] {
	return TOOL_NAMES.map((name) => ({
		name,
		description: SCHEMAS[name].description,
		parameters: SCHEMAS[name].parameters,
		handler: (args: Record<string, unknown>) => dispatch(name, args),
	}));
}
