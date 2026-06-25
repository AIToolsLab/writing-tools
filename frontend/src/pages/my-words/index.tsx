import {
	generateText,
	jsonSchema,
	type ModelMessage,
	isStepCount,
	tool,
} from 'ai';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AiOutlineSend } from 'react-icons/ai';

import { OPENAI_MODEL, openai } from '@/api/openai';
import { EditorContext } from '@/contexts/editorContext';
import { buildCorpus, validateText } from './corpus';
import classes from './styles.module.css';

const SYSTEM_PROMPT = `You are a writing collaborator working under one strict rule: you may edit the writer's document, but you may NEVER introduce your own words or phrases.

Every word you place in the document must come from the writer's own corpus — the document, their scratchpad, and their messages to you — joined only by punctuation and a small closed set of glue words (a, an, the, and, or, of, to, in, on, ...). The harness enforces this: any str_replace or insert whose text is not lifted from the corpus is REJECTED and returned to you with an explanation.

How to work:
- Use \`view\` to read the current document before editing. It numbers each paragraph like [3].
- Use \`str_replace\` and \`insert\` to weave the writer's existing phrases into clearer prose. Reuse their exact wording; only add punctuation and glue words.
- To add a new paragraph, prefer \`insert\` with a \`paragraph\` number (from \`view\`) and \`position\` — it is more reliable than anchoring on \`after\` text. Keep each edit to about a sentence.
- When you need words you don't have, do NOT invent them. Ask the writer a short question, or use \`highlight\` to point at the passage you're asking about.
- Take short turns. Your spoken replies must be one or two sentences — the writer sees them as fleeting captions, not a chat log.

Prefer asking the writer for their words over guessing. Never pad your replies.`;

/** A turn's worth of lightweight signals about what the writer just did. */
function buildActivityNote(opts: {
	scratchpad: string;
	scratchpadChanged: boolean;
	selectedText: string;
}): string | null {
	const parts: string[] = [];
	if (opts.scratchpadChanged && opts.scratchpad.trim().length > 0) {
		parts.push(`The writer's scratchpad now reads:\n"""\n${opts.scratchpad}\n"""`);
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

	// Running model transcript (assistant turns + tool calls/results).
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

		const tools = {
			view: tool({
				description:
					'Read the document. Each paragraph is prefixed with its 1-based number, e.g. [3], which you can target with the `insert` tool.',
				inputSchema: jsonSchema<Record<string, never>>({
					type: 'object',
					properties: {},
					additionalProperties: false,
				}),
				execute: async () => {
					const paragraphs = await editorAPI.getParagraphs();
					if (!paragraphs.some((p) => p.trim().length > 0)) {
						return '(the document is empty)';
					}
					return paragraphs
						.map((p, i) => `[${i + 1}] ${p}`)
						.join('\n');
				},
			}),
			str_replace: tool({
				description:
					"Replace the first occurrence of old_str with new_str. new_str must be lifted from the writer's corpus (plus glue words/punctuation).",
				inputSchema: jsonSchema<{ old_str: string; new_str: string }>({
					type: 'object',
					properties: {
						old_str: {
							type: 'string',
							description: 'Exact existing text to replace.',
						},
						new_str: {
							type: 'string',
							description:
								"Replacement text, drawn from the writer's words.",
						},
					},
					required: ['old_str', 'new_str'],
					additionalProperties: false,
				}),
				execute: async ({ old_str, new_str }) => {
					const check = validateText(new_str, await makeCorpus());
					if (!check.ok) {
						return `REJECTED: "${check.offending}" is not in the writer's words. Use only their phrases (plus glue words/punctuation), or ask them for the words you need.`;
					}
					try {
						await editorAPI.applyEdit({
							type: 'str_replace',
							oldStr: old_str,
							newStr: new_str,
						});
						return 'Applied.';
					} catch (e) {
						return `Could not apply: ${(e as Error).message}`;
					}
				},
			}),
			insert: tool({
				description:
					"Insert text, drawn from the writer's corpus (plus glue words/punctuation). To place a new paragraph reliably, pass `paragraph` (a number from `view`) and `position`. To add within an existing paragraph, pass `after` (existing text). With none of these, it inserts at the cursor.",
				inputSchema: jsonSchema<{
					text: string;
					after?: string;
					paragraph?: number;
					position?: 'before' | 'after';
				}>({
					type: 'object',
					properties: {
						text: {
							type: 'string',
							description:
								"Text to insert, drawn from the writer's words.",
						},
						after: {
							type: 'string',
							description:
								'Existing text to insert right after (within a paragraph).',
						},
						paragraph: {
							type: 'number',
							description:
								'1-based paragraph number from `view` to place a new paragraph relative to.',
						},
						position: {
							type: 'string',
							enum: ['before', 'after'],
							description:
								"Where to place it relative to `paragraph`. Defaults to 'after'.",
						},
					},
					required: ['text'],
					additionalProperties: false,
				}),
				execute: async ({ text, after, paragraph, position }) => {
					const check = validateText(text, await makeCorpus());
					if (!check.ok) {
						return `REJECTED: "${check.offending}" is not in the writer's words. Use only their phrases (plus glue words/punctuation), or ask them for the words you need.`;
					}
					try {
						await editorAPI.applyEdit({
							type: 'insert',
							text,
							after,
							paragraph,
							position,
						});
						return 'Applied.';
					} catch (e) {
						return `Could not apply: ${(e as Error).message}`;
					}
				},
			}),
			highlight: tool({
				description:
					'Select a passage in the document to point at it while asking the writer about it.',
				inputSchema: jsonSchema<{ phrase: string }>({
					type: 'object',
					properties: {
						phrase: {
							type: 'string',
							description: 'Existing text to highlight.',
						},
					},
					required: ['phrase'],
					additionalProperties: false,
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
			modelMessagesRef.current = [
				...modelMessagesRef.current,
				...result.response.messages,
			];
			setAiUtterance(result.text.trim() || 'Done — take a look.');
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
