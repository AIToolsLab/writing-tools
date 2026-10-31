/**
 * The Chat transcript: what the model reads (`ModelMessage[]`, tool calls and
 * all) and how that turns into the bubbles the writer sees.
 *
 * Each writer turn is one user message with two text parts: first the
 * `<document_context>` block the app attaches (the brief, the document on the
 * first turn, the text around the cursor), then what the writer typed. Keeping
 * them in one message means the context is part of the history the model
 * re-reads, appended rather than rewritten (#249), and the bubble shows only
 * the last part.
 */

import type { ModelMessage, UserModelMessage } from 'ai';

import { editNote } from '@/docTools/editNote';
import { viewParagraphs } from '@/docTools/report';

/** How much of the cursor's paragraph to show on each side. */
const CURSOR_RADIUS = 600;

/**
 * The paragraph the cursor (or selection) is in, clipped to `radius`
 * characters on each side, with the cursor or selection marked. Enough for
 * "here" and "this" to resolve; the model calls `view` for the rest.
 */
export function cursorWindow(
	{ beforeCursor, selectedText, afterCursor }: DocContext,
	radius = CURSOR_RADIUS,
): string {
	let before = beforeCursor.slice(beforeCursor.lastIndexOf('\n') + 1);
	const lineEnd = afterCursor.indexOf('\n');
	let after = lineEnd === -1 ? afterCursor : afterCursor.slice(0, lineEnd);
	if (before.length > radius) before = `…${before.slice(-radius)}`;
	if (after.length > radius) after = `${after.slice(0, radius)}…`;
	return selectedText === ''
		? `${before}<<CURSOR>>${after}`
		: `${before}<<SELECTION>>${selectedText}<</SELECTION>>${after}`;
}

/**
 * The `<document_context>` block for one writer turn. On the first turn
 * (`baseline` null) it carries the whole document; after that, a note of what
 * the writer changed since the model last saw it, if anything.
 */
export function documentContext({
	docContext,
	brief,
	paragraphs,
	baseline,
}: {
	docContext: DocContext;
	/** Prompt-formatted brief, or null when the writer hasn't set one. */
	brief: string | null;
	/** The document now. */
	paragraphs: string[];
	/** The document as the model last saw it; null on the first turn. */
	baseline: string[] | null;
}): string {
	const parts: string[] = [];
	if (brief) parts.push(brief);
	if (baseline === null) {
		parts.push(
			`The document (paragraph numbers are for your tools only):\n${viewParagraphs(paragraphs)}`,
		);
	} else {
		const note = editNote(baseline, paragraphs);
		if (note) parts.push(note);
	}
	const { beforeCursor, selectedText, afterCursor } = docContext;
	if (`${beforeCursor}${selectedText}${afterCursor}`.trim() !== '') {
		parts.push(
			selectedText === ''
				? `Around the cursor:\n${cursorWindow(docContext)}`
				: `The selection, in context:\n${cursorWindow(docContext)}`,
		);
	}
	return `<document_context>\n${parts.join('\n\n')}\n</document_context>`;
}

/** A writer turn: the attached context, then what they typed. */
export function writerTurn(context: string, text: string): UserModelMessage {
	return {
		role: 'user',
		content: [
			{ type: 'text', text: context },
			{ type: 'text', text },
		],
	};
}

/** What the writer typed: the last text part of their turn. */
export function writerText(message: UserModelMessage): string {
	if (typeof message.content === 'string') return message.content;
	const texts = message.content.filter((p) => p.type === 'text');
	return texts[texts.length - 1]?.text ?? '';
}

/** Everything the writer has typed this conversation (for the word bank). */
export function writerMessages(messages: ModelMessage[]): string[] {
	return messages.flatMap((m) => (m.role === 'user' ? [writerText(m)] : []));
}

/** Reasons the model reads when a proposal isn't applied. */
export const DECLINED_REASON = 'The writer declined this edit.';
const SET_ASIDE_PREFIX = 'The writer set this proposal aside';

export type ProposalStatus =
	| 'pending'
	| 'applying'
	| 'applied'
	| 'failed'
	| 'declined'
	| 'set-aside';

export interface ProposalItem {
	role: 'proposal';
	toolCallId: string;
	approvalId: string;
	toolName: string;
	input: unknown;
	status: ProposalStatus;
}

export interface DisplayMessage {
	role: 'user' | 'assistant';
	text: string;
}

export type DisplayItem = DisplayMessage | ProposalItem;

type ToolCall = { toolCallId: string; toolName: string; input: unknown };

/**
 * What the transcript records about each tool call: the call itself, the
 * writer's verdict on its approval (if asked), and its result.
 */
function indexToolCalls(messages: ModelMessage[]) {
	const calls = new Map<string, ToolCall>();
	const verdicts = new Map<string, boolean>(); // by approvalId
	const results = new Map<string, { type: string; reason?: string }>();
	for (const message of messages) {
		if (message.role === 'assistant' && typeof message.content !== 'string') {
			for (const part of message.content) {
				if (part.type === 'tool-call') calls.set(part.toolCallId, part);
			}
		} else if (message.role === 'tool') {
			for (const part of message.content) {
				if (part.type === 'tool-approval-response') {
					verdicts.set(part.approvalId, part.approved);
				} else if (part.type === 'tool-result') {
					const { output } = part;
					results.set(part.toolCallId, {
						type: output.type,
						reason:
							output.type === 'execution-denied'
								? output.reason
								: undefined,
					});
				}
			}
		}
	}
	return { calls, verdicts, results };
}

function proposalStatus(
	verdict: boolean | undefined,
	result: { type: string; reason?: string } | undefined,
): ProposalStatus {
	if (result?.type === 'execution-denied') {
		return result.reason?.startsWith(SET_ASIDE_PREFIX)
			? 'set-aside'
			: 'declined';
	}
	if (result) return result.type.startsWith('error') ? 'failed' : 'applied';
	if (verdict === undefined) return 'pending';
	return verdict ? 'applying' : 'declined';
}

/**
 * The bubbles and proposal cards for a transcript. Tool messages are skipped,
 * and the assistant's text across the steps of one reply (text, a `view` call,
 * more text) is joined into one bubble unless a proposal sits between.
 * Proposals the app denied on its own (the word-bank check) never show.
 */
export function displayTranscript(messages: ModelMessage[]): DisplayItem[] {
	const { calls, verdicts, results } = indexToolCalls(messages);
	const out: DisplayItem[] = [];
	const addText = (text: string) => {
		if (text === '') return;
		const last = out[out.length - 1];
		if (last?.role === 'assistant') last.text += `\n\n${text}`;
		else out.push({ role: 'assistant', text });
	};
	for (const message of messages) {
		if (message.role === 'user') {
			out.push({ role: 'user', text: writerText(message) });
		} else if (message.role === 'assistant') {
			if (typeof message.content === 'string') {
				addText(message.content);
				continue;
			}
			let text = '';
			for (const part of message.content) {
				if (part.type === 'text') {
					text += part.text;
				} else if (
					part.type === 'tool-approval-request' &&
					!part.isAutomatic
				) {
					const call = calls.get(part.toolCallId);
					if (!call) continue;
					addText(text);
					text = '';
					out.push({
						role: 'proposal',
						toolCallId: call.toolCallId,
						approvalId: part.approvalId,
						toolName: call.toolName,
						input: call.input,
						status: proposalStatus(
							verdicts.get(part.approvalId),
							results.get(call.toolCallId),
						),
					});
				}
			}
			addText(text);
		}
	}
	return out;
}

/** Proposals still waiting on the writer. */
export function pendingProposals(messages: ModelMessage[]): ProposalItem[] {
	return displayTranscript(messages).filter(
		(item): item is ProposalItem =>
			item.role === 'proposal' && item.status === 'pending',
	);
}

/**
 * The tool message that answers a proposal: the writer's verdict plus the
 * tool's result, both written by the app. The SDK skips any approval that
 * already has a result, so it only continues the conversation; and the
 * transcript stays valid whatever comes after it (a writer turn, a failed
 * model call), where an approval alone would leave the call without output.
 */
export function answerProposal(
	proposal: ProposalItem,
	answer:
		| { approved: true; ok: boolean; report: string }
		| { approved: false; reason: string },
): ModelMessage {
	return {
		role: 'tool',
		content: [
			{
				type: 'tool-approval-response',
				approvalId: proposal.approvalId,
				approved: answer.approved,
				reason: answer.approved ? undefined : answer.reason,
			},
			{
				type: 'tool-result',
				toolCallId: proposal.toolCallId,
				toolName: proposal.toolName,
				output: !answer.approved
					? { type: 'execution-denied', reason: answer.reason }
					: answer.ok
						? { type: 'text', value: answer.report }
						: { type: 'error-text', value: answer.report },
			},
		],
	};
}

/** The reason the model reads when the writer moved on without answering. */
export function setAsideReason(writerSaid: string): string {
	return `${SET_ASIDE_PREFIX} and said: "${writerSaid}"`;
}
