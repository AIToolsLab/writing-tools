/**
 * `Responder` backed by a live model via the AI SDK.
 *
 * It drives the tool loop *manually*: the tools carry schemas but no `execute`,
 * and we take one model step at a time (`isStepCount(1)`), so the *strategy* —
 * not the SDK — decides whether an edit is applied now or staged for consent.
 * The responder owns the native message history; strategies stay ignorant of it.
 *
 * The prompt here is deliberately loosened from the original: the word-bank rule
 * is enforced in code (`validateText`), so the prompt spends its words on stance
 * — one small move, then listen — not on policing. See
 * docs/my-words-interaction-design.md §4.4.
 */

import { generateText, isStepCount, tool, type ModelMessage } from 'ai';
import { z } from 'zod';

import type { Action, AssistantMove, Responder } from './types';

const BASE_PROMPT = `You help a writer shape their OWN words. You never contribute new words: every word you place in the document is lifted from the writer's corpus — the document, their scratchpad, and what they say to you — joined only by punctuation and small glue words. The app enforces this and REJECTS anything else, so don't spend attention policing it; spend it on being a good partner.

Work like a tutor in a writing conference: curious, reflective, non-directive. Make ONE small, concrete move at a time — a single edit, or a short spoken question — then hand the floor back. Prefer moving and tightening the writer's existing words over piling on new material. Spoken replies are one or two sentences, shown as fleeting captions — never pad them.

Tools: \`view\` (read the numbered document), \`str_replace\`/\`insert\`/\`move\` (small edits, drawn from the writer's words), \`highlight\` (point at a passage). Re-\`view\` before an edit when paragraph numbers may have shifted.`;

const tools = {
	view: tool({
		description:
			'Read the document (paragraphs numbered like [3], targetable by `insert`/`move`).',
		inputSchema: z.object({}),
	}),
	str_replace: tool({
		description:
			'Replace a SHORT span (a phrase or sentence within one paragraph) with text lifted from the writer’s words.',
		inputSchema: z.object({
			old_str: z.string(),
			new_str: z.string(),
		}),
	}),
	insert: tool({
		description:
			"Insert text lifted from the writer's words. Pass `paragraph`+`position` for a new paragraph, `after` for within a paragraph, or neither for the cursor.",
		inputSchema: z.object({
			text: z.string(),
			after: z.string().optional(),
			paragraph: z.number().int().optional(),
			position: z.enum(['before', 'after']).optional(),
		}),
	}),
	move: tool({
		description:
			'Relocate an existing passage (the writer’s own words) to another paragraph. Adds no words.',
		inputSchema: z.object({
			phrase: z.string(),
			paragraph: z.number().int(),
			position: z.enum(['before', 'after']).optional(),
		}),
	}),
	highlight: tool({
		description: 'Select a passage to point at it while you ask about it.',
		inputSchema: z.object({ phrase: z.string() }),
	}),
};

function toAction(toolName: string, input: unknown): Action | null {
	const a = input as Record<string, unknown>;
	switch (toolName) {
		case 'view':
			return { tool: 'view' };
		case 'highlight':
			return { tool: 'highlight', phrase: String(a.phrase) };
		case 'str_replace':
			return {
				tool: 'edit',
				op: {
					kind: 'str_replace',
					oldStr: String(a.old_str),
					newStr: String(a.new_str),
				},
			};
		case 'insert':
			return {
				tool: 'edit',
				op: {
					kind: 'insert',
					text: String(a.text),
					after: a.after as string | undefined,
					paragraph: a.paragraph as number | undefined,
					position: a.position as 'before' | 'after' | undefined,
				},
			};
		case 'move':
			return {
				tool: 'edit',
				op: {
					kind: 'move',
					phrase: String(a.phrase),
					paragraph: Number(a.paragraph),
					position: a.position as 'before' | 'after' | undefined,
				},
			};
		default:
			return null;
	}
}

export interface LiveResponderOptions {
	/** The AI SDK model (e.g. `openai.chat('gpt-5.5')`). */
	model: Parameters<typeof generateText>[0]['model'];
	/** Strategy-specific contract appended to the base prompt. */
	modePrompt: string;
}

export function createLiveResponder(opts: LiveResponderOptions): Responder {
	const system = `${BASE_PROMPT}\n\n${opts.modePrompt}`;
	const messages: ModelMessage[] = [];
	let pending: { toolCallId: string; toolName: string } | null = null;

	return {
		pushWriter(text: string) {
			messages.push({ role: 'user', content: text });
		},

		async next(): Promise<AssistantMove> {
			const result = await generateText({
				model: opts.model,
				system,
				messages,
				tools,
				stopWhen: isStepCount(1),
			});
			messages.push(...result.response.messages);

			const call = result.toolCalls[0];
			const say = result.text.trim() || undefined;
			if (!call) {
				pending = null;
				return { say };
			}
			pending = { toolCallId: call.toolCallId, toolName: call.toolName };
			const action = toAction(call.toolName, call.input) ?? undefined;
			return { say, action };
		},

		recordToolResult(text: string) {
			if (!pending) return;
			messages.push({
				role: 'tool',
				content: [
					{
						type: 'tool-result',
						toolCallId: pending.toolCallId,
						toolName: pending.toolName,
						output: { type: 'text', value: text },
					},
				],
			});
			pending = null;
		},
	};
}

/** Prompt addenda that tell the model each strategy's turn-taking contract. */
export const MODE_PROMPTS = {
	walkthrough: `After you make an edit, say in a few words what you did AND name the one small move you'd make next — phrase it so the writer can just say "ok" to let you carry it out. One move lands per turn; the writer steers as you go.`,
	propose: `You never edit the document directly. Each edit is a PROPOSAL: describe the single change and ask for it. The writer will accept or decline before anything touches the document. Propose one change at a time.`,
} as const;
