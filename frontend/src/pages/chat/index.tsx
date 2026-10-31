import { isStepCount, tool } from 'ai';
import {
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from 'react';
import {
	AiOutlineArrowDown,
	AiOutlinePlus,
	AiOutlineSend,
} from 'react-icons/ai';

import {
	describeGenerationError,
	type GenerationErrorInfo,
} from '@/api/errors';
import { streamParts } from '@/api/generate';
import { chatLog } from '@/api/logging';
import { languageModel, openaiProviderOptions } from '@/api/openai';
import { GenerationErrorNotice } from '@/components/errorNotice';
import BriefSection from '@/components/briefSection';
import {
	DocJumpStatus,
	DocTextMarkdown,
	useDocJump,
} from '@/components/docTextLink';
import { ChatContext } from '@/contexts/chatContext';
import {
	formatDocBriefForPrompt,
	useDocBrief,
} from '@/contexts/docBriefContext';
import { EditorContext } from '@/contexts/editorContext';
import { viewText } from '@/docTools/report';
import { useLog } from '@/hooks/useLog';
import { useDocContext } from '@/utilities';
import { z } from 'zod';

import classes from './styles.module.css';
import { displayTranscript, documentContext, writerTurn } from './transcript';

const suggestionPrompts = [
	'What is my main argument?',
	'How can I improve clarity?',
	'Is my structure logical?',
	'What am I missing?',
];

/**
 * The chat's system prompt. It is passed as the `instructions` option on the
 * generation call and deliberately kept *out* of the transcript: ai@7 rejects a
 * system-role message inside `messages` with "System messages are not allowed
 * in the prompt or messages fields."
 */
const CHAT_INSTRUCTIONS = `\
Help the user improve their writing. Encourage the user towards critical thinking and self-reflection. Be concise.

Each of the user's messages starts with a <document_context> block that the app attaches; the user doesn't see it and didn't write it. On their first message it holds the whole document, with paragraphs numbered like [3]; on every message it shows the text around their cursor or selection, marked with <<CURSOR>> or <<SELECTION>> tags. If the user mentions "here" or "this", assume they mean that area. The document may change between messages: call \`view\` to re-read it when you need the current text. The paragraph numbers are for your tools; the user doesn't see them, so mentioning them might confuse the user.

When referring to a specific part of the document, link to it so the user can jump straight there, using a Markdown link whose target is a doctext URL: [second paragraph of the intro](doctext:A%20short%20quote). The link target must start with "doctext:" and be a URL-component-encoded verbatim quote from the document — from a single line, at most 240 characters, with no surrounding quotation marks or paragraph numbers. The link text should be a short description of the place, not the quote itself. Only link to text that is actually in the document; quote it exactly.`;

/** Runaway cap on model steps (each tool call is a step) per writer turn. */
const MAX_STEPS = 6;

export default function Chat() {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	const editorAPI = useContext(EditorContext);
	const { brief } = useDocBrief();
	const log = useLog();
	// Read at send time, like the document context is, so a brief the writer
	// just edited applies to the very next message.
	const briefRef = useRef(brief);
	briefRef.current = brief;
	const activeRequestControllerRef = useRef<AbortController | null>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [showScrollButton, setShowScrollButton] = useState(false);
	const [errorInfo, setErrorInfo] = useState<GenerationErrorInfo | null>(
		null,
	);
	/**
	 * The message of a failed turn that was rolled back out of the transcript.
	 * Only such a turn can be retried — retrying one still in the transcript
	 * would send it twice.
	 */
	const [failedMessage, setFailedMessage] = useState<{
		text: string;
		source: 'input' | 'suggested';
	} | null>(null);

	// Show the "scroll to bottom" button when the user scrolls up, and hide it when they are near the bottom.
	const handleScroll = useCallback(() => {
		const container = messagesContainerRef.current;
		if (!container) return;
		const isNearBottom =
			container.scrollHeight -
				container.scrollTop -
				container.clientHeight <
			100;
		setShowScrollButton(!isNearBottom);
	}, []);

	// Instantly jumps the chat to the bottom upon user clicking the "scroll to bottom" button.
	const scrollToBottom = useCallback(() => {
		const container = messagesContainerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, []);

	// Auto-scroll when new messages arrive. `showScrollButton` is read but must stay
	// non-reactive — a scroll should fire on new messages, not when the button toggles.
	// useEffectEvent keeps that read out of the dependency array, so the effect runs
	// only on chatMessages and no exhaustive-deps suppression is needed.
	const scrollOnNewMessages = useEffectEvent(() => {
		if (!showScrollButton) {
			messagesContainerRef.current?.scrollTo({
				top: messagesContainerRef.current.scrollHeight,
				behavior: 'smooth',
			});
		}
	});

	useEffect(() => {
		scrollOnNewMessages();
	}, [chatMessages]);

	const { refresh: refreshDocContext } = useDocContext(editorAPI);
	const docJump = useDocJump('chat');

	const [isSendingMessage, updateSendingMessage] = useState(false);

	const [message, updateMessage] = useState('');

	/**
	 * The reply streaming in, shown as a bubble after the transcript until the
	 * turn finishes and its messages join the transcript. Null when idle.
	 */
	const [streamingText, setStreamingText] = useState<string | null>(null);

	const visibleMessages = displayTranscript(chatMessages);
	if (streamingText !== null) {
		visibleMessages.push({ role: 'assistant', text: streamingText });
	}

	const resizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
	}, []);

	useEffect(() => {
		resizeTextarea();
	}, [message, resizeTextarea]);

	useEffect(() => {
		return () => {
			// Cleanup on unmount: stop any in-flight stream to avoid post-unmount updates.
			activeRequestControllerRef.current?.abort();
		};
	}, []);

	async function submitMessage(text: string, source: 'input' | 'suggested') {
		// Only one active request is allowed; cancel any previous stream first.
		activeRequestControllerRef.current?.abort();
		const requestController = new AbortController();
		activeRequestControllerRef.current = requestController;

		chatLog.messageSent(log, { message: text, source });
		updateSendingMessage(true);
		setErrorInfo(null);
		setFailedMessage(null);

		// Pull the current document context at send time. The first turn also
		// carries the whole document, numbered as `view` numbers it.
		const docContext = await refreshDocContext();
		const context = documentContext({
			docContext,
			brief: formatDocBriefForPrompt(briefRef.current),
			paragraphs:
				chatMessages.length === 0
					? await editorAPI.getParagraphs()
					: null,
		});
		const withTurn = [...chatMessages, writerTurn(context, text)];

		updateChatMessages(withTurn);
		setStreamingText('');
		setShowScrollButton(false);
		updateMessage('');

		let streamed = '';
		try {
			const parts = streamParts({
				model: languageModel,
				providerOptions: openaiProviderOptions,
				instructions: CHAT_INSTRUCTIONS,
				messages: withTurn,
				tools: {
					view: tool({
						description:
							'Read the current document, paragraphs numbered like [3].',
						inputSchema: z.object({}),
						execute: () => viewText(editorAPI),
					}),
				},
				stopWhen: isStepCount(MAX_STEPS),
				abortSignal: requestController.signal,
			});

			let next = await parts.next();
			while (!next.done) {
				const part = next.value;
				if (part.type === 'text-delta') {
					streamed += part.text;
					setStreamingText(streamed);
				} else if (part.type === 'text-start' && streamed !== '') {
					// A new text block after a tool call: keep it a paragraph apart,
					// as the finished transcript renders it.
					streamed += '\n\n';
				}
				next = await parts.next();
			}
			if (requestController.signal.aborted) return;
			updateChatMessages([...withTurn, ...next.value]);
			chatLog.responseCompleted(log, {
				responseLength: streamed.length,
			});
		} catch (error) {
			if (requestController.signal.aborted) {
				return;
			}
			const info = describeGenerationError(error);
			console.error('Error while streaming chat response:', error);
			// Nothing streamed: roll the turn back and hand the text back to the
			// input box, so Retry re-sends it once rather than duplicating the
			// turn. If part of a reply did arrive, keep it and just show the error
			// under it.
			if (streamed.trim() === '') {
				updateChatMessages(chatMessages);
				updateMessage(text);
				setFailedMessage({ text, source });
			} else {
				updateChatMessages([
					...withTurn,
					{ role: 'assistant', content: streamed },
				]);
			}
			setErrorInfo(info);
			chatLog.responseError(log, {
				error: info.detail,
				code: info.code,
			});
		} finally {
			// Ignore stale completions from older requests that were already replaced.
			if (activeRequestControllerRef.current === requestController) {
				activeRequestControllerRef.current = null;
				updateSendingMessage(false);
				setStreamingText(null);
			}
		}
	}

	function startNewConversation() {
		activeRequestControllerRef.current?.abort();
		activeRequestControllerRef.current = null;
		updateSendingMessage(false);
		setStreamingText(null);
		setErrorInfo(null);
		setFailedMessage(null);
		updateMessage('');
		updateChatMessages([]);
		chatLog.conversationReset(log);
	}

	async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const trimmedMessage = message.trim();
		if (!trimmedMessage) return;

		await submitMessage(trimmedMessage, 'input');
	}

	async function sendSuggestedMessage(text: string) {
		updateMessage(text);
		await submitMessage(text, 'suggested');
	}

	return (
		<div className={classes.app}>
			{/* The document's brief — same section as on Revise, same stored
			    values; collapsed here so it costs one line above the transcript. */}
			<div className={classes.briefBar}>
				<BriefSection page="chat" />
			</div>

			<div className={classes.chatPanel}>
				{/* In the DOM before any link is clicked — a live region added
				    at the same moment as its text is not reliably announced. */}
				<DocJumpStatus jump={docJump} />

				{visibleMessages.length > 0 ? (
					<div className={classes.chatToolbar}>
						<button
							type="button"
							title="Start a new conversation"
							onClick={startNewConversation}
							className={classes.newConversationBtn}
						>
							<AiOutlinePlus size={12} />
							New conversation
						</button>
					</div>
				) : null}

				<div
					ref={messagesContainerRef}
					onScroll={handleScroll}
					className={classes.chatBody}
				>
					{visibleMessages.length === 0 ? (
						<div className={classes.chatWelcome}>
							<div className={classes.chatWelcomeTitle}>
								What do you think about your document so far?
							</div>

							<div className={classes.chatSuggestions}>
								{suggestionPrompts.map((prompt) => (
									<button
										key={prompt}
										type="button"
										onClick={() => {
											void sendSuggestedMessage(prompt);
										}}
										className={classes.chatSuggChip}
									>
										{prompt}
									</button>
								))}
							</div>
						</div>
					) : (
						visibleMessages.map((chatMessage, index) => {
							const isAssistantTyping =
								chatMessage.role === 'assistant' &&
								chatMessage.text === '' &&
								isSendingMessage;

							return (
								<div
									key={index}
									className={`${classes.chatMsg} ${chatMessage.role === 'user' ? classes.user : classes.ai}`}
								>
									{chatMessage.role === 'assistant' ? (
										<div className={classes.chatMeta}>
											Assistant
										</div>
									) : null}

									{isAssistantTyping ? (
										<div
											className={classes.typingIndicator}
										>
											<span />
											<span />
											<span />
										</div>
									) : (
										<div className={classes.chatBubble}>
											{chatMessage.role ===
											'assistant' ? (
												<DocTextMarkdown jump={docJump}>
													{chatMessage.text}
												</DocTextMarkdown>
											) : (
												chatMessage.text
											)}
										</div>
									)}

									{chatMessage.role === 'user' ? (
										<div className={classes.chatMeta}>
											You
										</div>
									) : null}
								</div>
							);
						})
					)}

					{errorInfo ? (
						<GenerationErrorNotice
							info={errorInfo}
							title="Couldn't get a reply"
							onRetry={
								failedMessage
									? () =>
											void submitMessage(
												failedMessage.text,
												failedMessage.source,
											)
									: undefined
							}
						/>
					) : null}
				</div>

				{showScrollButton ? (
					<button
						type="button"
						title="Scroll to bottom"
						onClick={scrollToBottom}
						className={classes.scrollButton}
					>
						<AiOutlineArrowDown size={16} />
					</button>
				) : null}
			</div>

			<form
				className={classes.chatFoot}
				onSubmit={(e) => {
					void sendMessage(e);
				}}
			>
				<div className={classes.chatInputRow}>
					<textarea
						ref={textareaRef}
						disabled={isSendingMessage}
						placeholder="Ask something about your document..."
						value={message}
						onChange={(e) => updateMessage(e.target.value)}
						onInput={resizeTextarea}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
						rows={1}
						className={classes.chatInput}
					/>

					<button
						type="submit"
						title="Send message"
						disabled={isSendingMessage || !message.trim()}
						className={classes.chatSendBtn}
					>
						<AiOutlineSend size={18} />
					</button>
				</div>
			</form>
		</div>
	);
}
