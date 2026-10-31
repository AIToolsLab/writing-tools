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
function writerText(message: UserModelMessage): string {
	if (typeof message.content === 'string') return message.content;
	const texts = message.content.filter((p) => p.type === 'text');
	return texts[texts.length - 1]?.text ?? '';
}

export interface DisplayMessage {
	role: 'user' | 'assistant';
	text: string;
}

/**
 * The bubbles for a transcript. Tool messages are skipped, and the assistant's
 * text across the steps of one reply (text, a `view` call, more text) is
 * joined into one bubble.
 */
export function displayTranscript(messages: ModelMessage[]): DisplayMessage[] {
	const out: DisplayMessage[] = [];
	for (const message of messages) {
		if (message.role === 'user') {
			out.push({ role: 'user', text: writerText(message) });
		} else if (message.role === 'assistant') {
			const text =
				typeof message.content === 'string'
					? message.content
					: message.content
							.filter((p) => p.type === 'text')
							.map((p) => p.text)
							.join('');
			if (text === '') continue;
			const last = out[out.length - 1];
			if (last?.role === 'assistant') last.text += `\n\n${text}`;
			else out.push({ role: 'assistant', text });
		}
	}
	return out;
}
