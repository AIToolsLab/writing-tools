/**
 * Chat's tools and approval policy.
 *
 * `view` reads the document. On hosts that can edit (`canEdit`), the own-words
 * edit tools propose changes: each call first passes the word-bank check and
 * a dry run against the current document, in `toolApproval`. A failure is
 * denied there, with a reason the model reads and the writer never sees; a
 * pass waits for the writer's approval. The app applies an approved edit
 * itself (`applyProposal`) and writes its result into the transcript, so the
 * SDK never runs these tools' `execute`; it throws rather than editing.
 */

import {
	tool,
	type ModelMessage,
	type ToolApprovalConfiguration,
	type ToolSet,
} from 'ai';
import { z } from 'zod';

import { chatLog } from '@/api/logging';
import type { AppliedEdit, ChatDocState } from '@/contexts/chatContext';
import { recordSeen } from '@/contexts/chatContext';
import { buildCorpus } from '@/docTools/corpus';
import { canEdit } from '@/docTools/editor';
import {
	editToolSpecs,
	isEditToolName,
	toEditOp,
	type EditToolName,
} from '@/docTools/editTools';
import { invertSplices, lowerOp, withNeighbors } from '@/docTools/ops';
import { applyOpAndReport, validateOp, viewParagraphs } from '@/docTools/report';
import type { LogFn } from '@/hooks/useLog';

import { writerMessages } from './transcript';

export interface ChatToolsOptions {
	editor: EditorAPI;
	docState: ChatDocState;
	/** The writer's brief fields, which count as their words. */
	briefText: () => string[];
	/** The transcript the turn is running on (for the writer's messages). */
	messages: () => ModelMessage[];
	onApplied: (toolCallId: string, edit: AppliedEdit) => void;
	log: LogFn;
}

/** The per-tool form of `toolApproval` (not the single-function form). */
type PerToolApproval = Exclude<
	ToolApprovalConfiguration<ToolSet, unknown>,
	(...args: never[]) => unknown
>;

/** The outcome of applying an approved proposal, as the model will read it. */
export type ProposalResult = { ok: boolean; report: string };

export function chatTools(opts: ChatToolsOptions): {
	tools: ToolSet;
	toolApproval: PerToolApproval;
	/**
	 * Apply an approved proposal: the only code path that edits the document.
	 * The Accept handler calls it and writes the result into the transcript
	 * before the model continues.
	 */
	applyProposal: (
		toolCallId: string,
		toolName: string,
		input: unknown,
	) => Promise<ProposalResult>;
} {
	const { editor, docState, log } = opts;
	const tools: ToolSet = {
		view: tool({
			description:
				'Read the current document, paragraphs numbered like [3].',
			inputSchema: z.object({}),
			execute: async () => {
				const paragraphs = await editor.getParagraphs();
				recordSeen(docState, paragraphs);
				return viewParagraphs(paragraphs);
			},
		}),
	};
	const toolApproval: PerToolApproval = { view: 'not-applicable' };
	if (!canEdit(editor)) {
		return {
			tools,
			toolApproval,
			applyProposal: () =>
				Promise.resolve({
					ok: false,
					report: 'This editor can’t apply edits.',
				}),
		};
	}

	const applyProposal = async (
		toolCallId: string,
		toolName: string,
		input: unknown,
	): Promise<ProposalResult> => {
		if (!isEditToolName(toolName)) {
			return { ok: false, report: `Unknown edit tool ${toolName}.` };
		}
		const op = toEditOp(toolName, input);
		// Approved already, so no reveal beat: apply straight away.
		const result = await applyOpAndReport(editor, op, { revealMs: 0 });
		if (!result.ok) {
			void chatLog.edit(log, 'failed', {
				tool: toolName,
				kind: op.kind,
				toolCallId,
				proposal: op,
			});
			return result;
		}
		// The model knows about its own edit; don't report it back as the
		// writer's in the next edit note.
		recordSeen(docState, result.paragraphs);
		opts.onApplied(toolCallId, {
			undo: withNeighbors(result.paragraphs, invertSplices(result.splices)),
			undone: false,
		});
		return { ok: true, report: result.report };
	};

	const corpus = async () =>
		buildCorpus({
			docText: await editor.getDocText(),
			userMessages: [
				...writerMessages(opts.messages()),
				...opts.briefText(),
				...docState.seen,
			],
		});

	for (const name of Object.keys(editToolSpecs) as EditToolName[]) {
		const spec = editToolSpecs[name];
		// Widened so one loop builds all three; `toEditOp` re-types the input.
		const inputSchema: z.ZodType<unknown> = spec.inputSchema;
		tools[name] = tool({
			description: spec.description,
			inputSchema,
			// Unreachable: every answer to a proposal carries its result, and
			// the SDK skips approvals that already have one. If that ever breaks,
			// fail visibly rather than edit the document from a second path.
			execute: (): Promise<string> =>
				Promise.reject(
					new Error(
						'Edit proposals are applied by the app, not by the tool.',
					),
				),
		});
		toolApproval[name] = async (input, { toolCallId }) => {
			const op = toEditOp(name, input);
			const logData = { tool: name, kind: op.kind, toolCallId, proposal: op };
			try {
				lowerOp(await editor.getParagraphs(), op);
			} catch (e) {
				void chatLog.edit(log, 'auto_denied', {
					...logData,
					reason: 'no_match',
				});
				return {
					type: 'denied',
					reason: `That edit doesn't apply to the current document: ${(e as Error).message} Re-check with \`view\`.`,
				};
			}
			const check = validateOp(op, await corpus());
			if (!check.ok) {
				void chatLog.edit(log, 'auto_denied', {
					...logData,
					reason: 'word_bank',
					offending: check.offending,
				});
				return {
					type: 'denied',
					reason: `Not the writer's words: ${check.problem ?? `"${check.offending}"`}. Rephrase using only their words, or ask them instead.`,
				};
			}
			void chatLog.edit(log, 'proposed', logData);
			return 'user-approval';
		};
	}
	return { tools, toolApproval, applyProposal };
}
