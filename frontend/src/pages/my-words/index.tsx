import {
	generateText,
	type ModelMessage,
	isStepCount,
	tool,
} from 'ai';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AiOutlineSend } from 'react-icons/ai';
import { z } from 'zod';

import { OPENAI_MODEL, openai } from '@/api/openai';
import { EditorContext } from '@/contexts/editorContext';
import { buildCorpus, validateText } from './corpus';
import classes from './styles.module.css';

const SYSTEM_PROMPT = `You are a writing tutor helping a writer develop their OWN writing. Two things define your role.

1) You never contribute words. Every word you place in the document must come from the writer's own corpus — the document, their scratchpad, and their messages to you — joined only by punctuation and a small closed set of glue words (a, an, the, and, or, of, to, in, on, ...). Treat all three as a single word bank you may quote from freely: every line of the scratchpad, and everything the writer has typed or said to you in this conversation, is fair game to lift, exactly like the document text itself. (Their messages are a source of words, not just instructions.) The harness enforces this: any edit whose text is not lifted from the corpus is REJECTED. Your edits only ever rearrange, tighten, or connect the writer's existing words; the ideas and the language stay theirs.

2) You are non-directive. Lead with curiosity, like a good tutor in a writing conference. Ask open questions about what the writer means, what they most want to say, how two ideas connect, what matters most here. Reflect their own words back to them. Draw out their thinking instead of prescribing a direction, and never impose your own thesis or opinion.

Hold these together: talk like a tutor (questions, reflection, encouragement) and edit like a careful hand arranging the writer's words. Favor one small, concrete move plus a question over a sweeping rewrite. When you are unsure what the writer wants, ask before editing.

Working with the tools:
- Use \`view\` to read the document (paragraphs numbered like [3]) and the writer's scratchpad of source words. Re-\`view\` whenever you're told the scratchpad changed.
- \`str_replace\` works on a SHORT span within a single paragraph — keep old_str to a phrase or sentence, and never let it cross a paragraph break. For a bigger change, make several small replacements.
- To add or move a paragraph, use \`insert\` with a \`paragraph\` number (from \`view\`) and \`position\`. Paragraph numbers shift after an edit, so use the numbers in the tool result (or call \`view\` again) before your next placement.
- Use \`highlight\` to point at a passage while you ask the writer about it.
- When you need words you don't have, do NOT invent them — ask the writer for them.

Take short turns. Your spoken replies are one or two sentences shown to the writer as fleeting captions, not a chat log. Never pad them.`;

/** A turn's worth of lightweight signals about what the writer just did. */
function buildActivityNote(opts: {
	scratchpad: string;
	scratchpadChanged: boolean;
	selectedText: string;
}): string | null {
	const parts: string[] = [];
	if (opts.scratchpadChanged && opts.scratchpad.trim().length > 0) {
		// Lightweight flag only — the current scratchpad is available via `view`,
		// so we don't push its (potentially large, ever-accumulating) text here.
		parts.push(
			'The writer has edited their scratchpad since you last looked — call `view` to see the current source words before quoting from it.',
		);
	}
	if (opts.selectedText.trim().length > 0) {
		parts.push(`The writer has selected this passage: "${opts.selectedText}"`);
	}
	return parts.length > 0 ? parts.join('\n\n') : null;
}

export default function MyWords() {
	const editorAPI = useContext(EditorContext);

	// The writer's own material.
	const [scratchpad, setScratchpad] = useState('');
	const [sentMessages, setSentMessages] = useState<string[]>([]);

	// Ephemeral AI caption — replaced each turn, never kept as scrollback.
	const [aiUtterance, setAiUtterance] = useState(
		"Tell me what you're trying to say, and I'll help you shape it in your own words.",
	);
	const [isThinking, setIsThinking] = useState(false);
	const [input, setInput] = useState('');

	// Refs read by the tool loop / activity tracking (always latest values).
	const scratchpadRef = useRef(scratchpad);
	scratchpadRef.current = scratchpad;
	const sentMessagesRef = useRef<string[]>(sentMessages);
	sentMessagesRef.current = sentMessages;

	// Durable conversation transcript: the writer's turns and the assistant's
	// captions only. Intermediate tool steps (view dumps, edit confirmations)
	// are deliberately NOT retained across turns — see runTurn.
	const modelMessagesRef = useRef<ModelMessage[]>([]);
	// What we last told the model, so signals stay lightweight (only deltas).
	const lastSentScratchpadRef = useRef('');
	const selectedTextRef = useRef('');

	// Track the document selection so we can surface it as an activity signal.
	useEffect(() => {
		const handler = () => {
			void editorAPI
				.getDocContext()
				.then((ctx) => {
					selectedTextRef.current = ctx.selectedText ?? '';
				})
				.catch(() => {});
		};
		editorAPI.addSelectionChangeHandler(handler);
		return () => editorAPI.removeSelectionChangeHandler(handler);
	}, [editorAPI]);

	const runTurn = useCallback(async () => {
		setIsThinking(true);

		// Snapshot the writer's material for this turn. The document is read
		// fresh inside each tool call, so edits the AI makes stay consistent.
		const scratchpadNow = scratchpadRef.current;
		const messagesNow = sentMessagesRef.current;

		const makeCorpus = async () =>
			buildCorpus({
				docText: await editorAPI.getDocText(),
				scratchpad: scratchpadNow,
				userMessages: messagesNow,
			});

		// Report what the document looks like right after an edit so the model
		// can track paragraph-number shifts. Lightweight: total count + a 3-line
		// window around the change, each line clipped.
		const describeChange = async (probe: string): Promise<string> => {
			const paragraphs = await editorAPI.getParagraphs();
			const total = paragraphs.length;
			const fragment = probe.trim().slice(0, 40);
			const k = fragment
				? paragraphs.findIndex((p) => p.includes(fragment))
				: -1;
			if (k === -1) {
				return `Applied. The document now has ${total} paragraph(s).`;
			}
			const clip = (s: string) =>
				s.length > 120 ? `${s.slice(0, 117)}…` : s;
			const lo = Math.max(0, k - 1);
			const hi = Math.min(total - 1, k + 1);
			const window = paragraphs
				.slice(lo, hi + 1)
				.map((p, i) => `[${lo + i + 1}] ${clip(p)}`)
				.join('\n');
			return `Applied. The document now has ${total} paragraph(s); numbers may have shifted. Around your edit:\n${window}`;
		};

		const tools = {
			view: tool({
				description:
					"Read the document (paragraphs numbered like [3], which you can target with `insert`) together with the writer's scratchpad of source words. Paragraph numbers refer to the document only.",
				inputSchema: z.object({}),
				execute: async () => {
					const paragraphs = await editorAPI.getParagraphs();
					const docPart = paragraphs.some(
						(p) => p.trim().length > 0,
					)
						? paragraphs
								.map((p, i) => `[${i + 1}] ${p}`)
								.join('\n')
						: '(the document is empty)';
					const scratch = scratchpadNow.trim();
					const scratchPart =
						scratch.length > 0
							? `\n\n--- The writer's scratchpad (source words you may quote; not part of the document, so no paragraph numbers) ---\n${scratch}`
							: '';
					return `${docPart}${scratchPart}`;
				},
			}),
			str_replace: tool({
				description:
					"Replace the first occurrence of old_str with new_str. old_str must be a SHORT span within a single paragraph (a phrase or sentence) and must not cross a paragraph break. new_str must be lifted from the writer's corpus (plus glue words/punctuation).",
				inputSchema: z.object({
					old_str: z
						.string()
						.describe(
							'A short existing span to replace — a phrase or sentence within ONE paragraph. Must not span a paragraph break.',
						),
					new_str: z
						.string()
						.describe(
							"Replacement text, drawn only from the writer's words plus glue/punctuation.",
						),
				}),
				execute: async ({ old_str, new_str }) => {
					const check = validateText(new_str, await makeCorpus());
					if (!check.ok) {
						return `REJECTED: "${check.offending}" is not in the writer's words. You may lift from anywhere in their word bank — the document, the scratchpad, or anything they've typed to you — plus glue words/punctuation. If the words you need aren't there, ask the writer for them.`;
					}
					try {
						await editorAPI.applyEdit({
							type: 'str_replace',
							oldStr: old_str,
							newStr: new_str,
						});
						return await describeChange(new_str);
					} catch (e) {
						return `Could not apply: ${(e as Error).message} Keep old_str to a short span inside one paragraph (it cannot cross a paragraph break), or make the change as several smaller replacements.`;
					}
				},
			}),
			insert: tool({
				description:
					"Insert text, drawn from the writer's corpus (plus glue words/punctuation). To place a new paragraph reliably, pass `paragraph` (a number from `view`) and `position`. To add within an existing paragraph, pass `after` (existing text). With none of these, it inserts at the cursor.",
				inputSchema: z.object({
					text: z
						.string()
						.describe(
							"Text to insert, drawn only from the writer's words plus glue/punctuation.",
						),
					after: z
						.string()
						.optional()
						.describe(
							'Existing text to insert right after (within a paragraph).',
						),
					paragraph: z
						.number()
						.int()
						.optional()
						.describe(
							'1-based paragraph number from `view` to place a new paragraph relative to.',
						),
					position: z
						.enum(['before', 'after'])
						.optional()
						.describe(
							"Where to place it relative to `paragraph`. Defaults to 'after'.",
						),
				}),
				execute: async ({ text, after, paragraph, position }) => {
					const check = validateText(text, await makeCorpus());
					if (!check.ok) {
						return `REJECTED: "${check.offending}" is not in the writer's words. You may lift from anywhere in their word bank — the document, the scratchpad, or anything they've typed to you — plus glue words/punctuation. If the words you need aren't there, ask the writer for them.`;
					}
					try {
						await editorAPI.applyEdit({
							type: 'insert',
							text,
							after,
							paragraph,
							position,
						});
						return await describeChange(text);
					} catch (e) {
						return `Could not apply: ${(e as Error).message}`;
					}
				},
			}),
			highlight: tool({
				description:
					'Select a passage in the document to point at it while asking the writer about it.',
				inputSchema: z.object({
					phrase: z
						.string()
						.describe('Existing text to highlight.'),
				}),
				execute: async ({ phrase }) => {
					try {
						await editorAPI.selectPhrase(phrase);
						return 'Highlighted.';
					} catch {
						return `Could not find "${phrase}" in the document.`;
					}
				},
			}),
		};

		try {
			const result = await generateText({
				model: openai.chat(OPENAI_MODEL),
				instructions: SYSTEM_PROMPT,
				messages: modelMessagesRef.current,
				tools,
				stopWhen: isStepCount(8),
				// Visibility: log every tool call + its result as each step
				// resolves. Tool failures (REJECTED / "Could not apply…" /
				// search misses) are returned to the model as strings, so they
				// never throw — without this they'd be invisible here.
				onStepEnd: (step) => {
					for (const call of step.toolCalls) {
						const res = step.toolResults.find(
							(r) => r.toolCallId === call.toolCallId,
						);
						const output = res?.output;
						const failed =
							typeof output === 'string' &&
							/^(REJECTED|Could not)/.test(output);
						console[failed ? 'warn' : 'debug'](
							`[my-words] ${call.toolName}`,
							{ input: call.input, output },
						);
					}
				},
			});
			// Persist only the conversation: the writer's turn is already in the
			// transcript, so add the assistant's caption. We deliberately DROP the
			// turn's tool calls/results — view dumps, paragraph-window confirmations,
			// rejections — so stale full-document/scratchpad snapshots don't
			// accumulate in the context window. The document is the source of truth;
			// the model re-reads it with `view` when it needs current state.
			const utterance = result.text.trim() || 'Done — take a look.';
			modelMessagesRef.current = [
				...modelMessagesRef.current,
				{ role: 'assistant', content: utterance },
			];
			setAiUtterance(utterance);
		} catch (e) {
			// Surface the full error for diagnosis; the caption only shows the
			// message. Tool-argument/schema errors from the SDK land here too.
			console.error('[my-words] turn failed', e);
			setAiUtterance(`⚠️ ${(e as Error).message}`);
		} finally {
			setIsThinking(false);
		}
	}, [editorAPI]);

	const send = useCallback(async () => {
		const text = input.trim();
		if (!text || isThinking) return;

		// The writer's message becomes part of their corpus and the transcript.
		setSentMessages((prev) => [...prev, text]);
		setInput('');

		const note = buildActivityNote({
			scratchpad: scratchpadRef.current,
			scratchpadChanged:
				scratchpadRef.current !== lastSentScratchpadRef.current,
			selectedText: selectedTextRef.current,
		});
		lastSentScratchpadRef.current = scratchpadRef.current;

		const content = note ? `${note}\n\n---\n\n${text}` : text;
		modelMessagesRef.current = [
			...modelMessagesRef.current,
			{ role: 'user', content },
		];

		await runTurn();
	}, [input, isThinking, runTurn]);

	return (
		<div className={classes.page}>
			<div className={classes.aiCaption} aria-live="polite">
				{isThinking ? (
					<span className={classes.thinking}>
						<span />
						<span />
						<span />
					</span>
				) : (
					aiUtterance
				)}
			</div>

			<label className={classes.scratchLabel} htmlFor="mywords-scratchpad">
				Your words — scratchpad
			</label>
			<textarea
				id="mywords-scratchpad"
				className={classes.scratchpad}
				placeholder="Brain-dump here in your own words. The AI can only build the document out of what you write or say."
				value={scratchpad}
				onChange={(e) => setScratchpad(e.target.value)}
			/>

			{sentMessages.length > 0 ? (
				<div className={classes.saidList}>
					{sentMessages.map((m, i) => (
						<div key={i} className={classes.said}>
							{m}
						</div>
					))}
				</div>
			) : null}

			<form
				className={classes.inputRow}
				onSubmit={(e) => {
					e.preventDefault();
					void send();
				}}
			>
				<textarea
					className={classes.input}
					placeholder="Say what you want to do…"
					value={input}
					rows={1}
					disabled={isThinking}
					onChange={(e) => setInput(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && !e.shiftKey) {
							e.preventDefault();
							e.currentTarget.form?.requestSubmit();
						}
					}}
				/>
				<button
					type="submit"
					className={classes.sendBtn}
					title="Send"
					disabled={isThinking || !input.trim()}
				>
					<AiOutlineSend size={18} />
				</button>
			</form>
		</div>
	);
}
