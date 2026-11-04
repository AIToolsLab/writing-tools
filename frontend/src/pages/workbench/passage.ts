/**
 * What the Workbench takes off to the side, and the prompt around it.
 *
 * The passage is the selection if there is one, otherwise the sentence or
 * paragraph at the cursor. Context is deliberately small — the brief and the
 * paragraph before — rather than the whole document: scoring returns a
 * distribution for every prompt token, and the token-level requests run on
 * every pause in typing.
 */
import type { ChatMessage } from '@/api/vllm';

export type PassageScope = 'sentence' | 'paragraph';

export interface Passage {
	text: string;
	/** Where it came from, for the label and the log. */
	source: 'selection' | PassageScope;
	/** The paragraph before the passage's paragraph, if any. */
	previousParagraph: string;
}

/** Paragraphs are separated by newlines (Word's `\r` is normalized upstream). */
function paragraphBounds(text: string, at: number): [number, number] {
	const start = text.lastIndexOf('\n', at - 1) + 1;
	const nl = text.indexOf('\n', at);
	return [start, nl === -1 ? text.length : nl];
}

function previousParagraphBefore(text: string, paragraphStart: number): string {
	// Skip blank lines between paragraphs.
	const before = text.slice(0, paragraphStart).replace(/\s+$/, '');
	return before.slice(before.lastIndexOf('\n') + 1).trim();
}

// A sentence ends at . ! or ? (optionally followed by closing quotes or
// brackets) and then whitespace. Crude, and wrong for "e.g. this", but the
// writer can see and fix the passage before working on it.
const SENTENCE_END = /[.!?]["'”’)\]]*\s+/g;

function sentenceBounds(
	paragraph: string,
	at: number,
): [start: number, end: number] {
	let start = 0;
	for (const m of paragraph.matchAll(SENTENCE_END)) {
		const end = m.index + m[0].length;
		if (end > at) return [start, m.index + m[0].trimEnd().length];
		start = end;
	}
	return [start, paragraph.length];
}

/**
 * The passage for a document context. NFC-normalized, because Qwen's
 * tokenizer normalizes to NFC and highlight offsets are counted on its output.
 */
export function extractPassage(
	ctx: Pick<DocContext, 'beforeCursor' | 'selectedText' | 'afterCursor'>,
	scope: PassageScope,
): Passage {
	const doc = ctx.beforeCursor + ctx.selectedText + ctx.afterCursor;
	const cursor = ctx.beforeCursor.length;
	if (ctx.selectedText.trim()) {
		const [pStart] = paragraphBounds(doc, cursor);
		return {
			text: ctx.selectedText.trim().normalize('NFC'),
			source: 'selection',
			previousParagraph: previousParagraphBefore(doc, pStart).normalize(
				'NFC',
			),
		};
	}
	const [pStart, pEnd] = paragraphBounds(doc, cursor);
	const paragraph = doc.slice(pStart, pEnd);
	let text = paragraph;
	if (scope === 'sentence') {
		const [s, e] = sentenceBounds(paragraph, cursor - pStart);
		text = paragraph.slice(s, e);
	}
	return {
		text: text.trim().normalize('NFC'),
		source: scope,
		previousParagraph: previousParagraphBefore(doc, pStart).normalize(
			'NFC',
		),
	};
}

export const REWRITE_ADJECTIVES = [
	'clear and concise',
	'more detailed and engaging',
	'more formal and professional',
	'more casual and conversational',
	'more technical and precise',
	'more persuasive and compelling',
];

export const DEFAULT_INSTRUCTION = `Rewrite this passage to be ${REWRITE_ADJECTIVES[0]}.`;

/**
 * The one-turn conversation the passage is scored and predicted against: the
 * writer asks for `instruction` applied to `source`; the response is either
 * the passage itself (highlights) or the writer's own rewrite (predictions).
 *
 * Stable content goes first — brief, then previous paragraph — so vLLM's
 * prefix cache can reuse it across requests.
 */
export function taskMessages({
	instruction,
	source,
	brief,
	previousParagraph,
}: {
	instruction: string;
	source: string;
	brief: string | null;
	previousParagraph: string;
}): ChatMessage[] {
	const parts: string[] = [];
	if (brief) parts.push(brief);
	if (previousParagraph) {
		parts.push(
			`For context, this is the paragraph just before the passage:\n\n${previousParagraph}`,
		);
	}
	parts.push(instruction, source);
	return [{ role: 'user', content: parts.join('\n\n') }];
}

/**
 * Ranges computed for `before`, adjusted to `after`: ranges outside the edited
 * region shift with the text; ranges that overlap it are dropped until the
 * next result arrives.
 */
export function followEdits<R extends { start: number; end: number }>(
	before: string,
	after: string,
	ranges: R[],
): R[] {
	if (before === after) return ranges;
	const max = Math.min(before.length, after.length);
	let prefix = 0;
	while (prefix < max && before[prefix] === after[prefix]) prefix++;
	let suffix = 0;
	while (
		suffix < max - prefix &&
		before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
	) {
		suffix++;
	}
	const shift = after.length - before.length;
	const editEnd = before.length - suffix;
	return ranges.flatMap((r) =>
		r.end <= prefix
			? [r]
			: r.start >= editEnd
				? [{ ...r, start: r.start + shift, end: r.end + shift }]
				: [],
	);
}
