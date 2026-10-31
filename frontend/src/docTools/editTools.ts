/**
 * The own-words edit tools: their schemas, and the mapping from a tool call's
 * input to an `EditOp`. Hosts wire them up with their own `execute` and
 * approval policy (Chat: word-bank check, then the writer's approval).
 */

import { z } from 'zod';

import type { EditOp } from './types';

const OWN_WORDS =
	'Every word you add must be lifted from the writer’s own words (the document and what they’ve said to you), joined only by punctuation and small glue words (a, an, the, and, or, but, of, to, in, on, at, by, for, with, from); anything else is rejected before the writer sees it.';

const paragraph = z
	.number()
	.int()
	.describe('1-based paragraph number from `view` or the document context.');

export const editToolSpecs = {
	str_replace: {
		description: `Propose replacing a SHORT span (a phrase or sentence within one paragraph). Pass \`paragraph\` so the replace is scoped there. ${OWN_WORDS}`,
		inputSchema: z.object({
			old_str: z.string(),
			new_str: z.string(),
			paragraph: paragraph.optional(),
		}),
	},
	insert: {
		description: `Propose inserting text. Pass \`paragraph\`+\`position\` for a new paragraph, or \`after\` (a quote) to insert within a paragraph. ${OWN_WORDS}`,
		inputSchema: z.object({
			text: z.string(),
			after: z.string().optional(),
			paragraph: paragraph.optional(),
			position: z.enum(['before', 'after']).optional(),
		}),
	},
	move: {
		description:
			'Propose relocating an existing passage (the writer’s own words, quoted exactly) to before or after another paragraph. Adds no words.',
		inputSchema: z.object({
			phrase: z.string(),
			paragraph,
			position: z.enum(['before', 'after']).optional(),
		}),
	},
};

export type EditToolName = keyof typeof editToolSpecs;

export type EditToolInput<NAME extends EditToolName> = z.infer<
	(typeof editToolSpecs)[NAME]['inputSchema']
>;

export function isEditToolName(name: string): name is EditToolName {
	return name in editToolSpecs;
}

/** The `EditOp` a tool call's (schema-validated) input describes. */
export function toEditOp(name: EditToolName, input: unknown): EditOp {
	switch (name) {
		case 'str_replace': {
			const a = input as EditToolInput<'str_replace'>;
			return {
				kind: 'str_replace',
				oldStr: a.old_str,
				newStr: a.new_str,
				paragraph: a.paragraph,
			};
		}
		case 'insert': {
			const a = input as EditToolInput<'insert'>;
			return {
				kind: 'insert',
				text: a.text,
				after: a.after,
				paragraph: a.paragraph,
				position: a.position,
			};
		}
		case 'move': {
			const a = input as EditToolInput<'move'>;
			return {
				kind: 'move',
				phrase: a.phrase,
				paragraph: a.paragraph,
				position: a.position,
			};
		}
	}
}
