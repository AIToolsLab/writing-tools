import { type ModelMessage } from 'ai';
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
import { streamTextDeltas } from '@/api/generate';
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
import { useLog } from '@/hooks/useLog';
import { useDocContext } from '@/utilities';
import classes from './styles.module.css';

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
Help the user improve their writing. Encourage the user towards critical thinking and self-reflection. Be concise. If the user mentions "here" or "this", assume they are referring to the area near the cursor or selection.

When referring to a specific part of the document, link to it so the user can jump straight there, using a Markdown link whose target is a doctext URL: [second paragraph of the intro](doctext:A%20short%20quote). The link target must start with "doctext:" and be a URL-component-encoded verbatim quote from the document — from a single line, at most 240 characters, with no surrounding quotation marks. The link text should be a short description of the place, not the quote itself. Only link to text that is actually in the document; quote it exactly.`;

const CHAT_GREETING_MESSAGE: ChatMessage = {
	role: 'assistant',
	content: 'What do you think about your document so far?',
};

/**
 * The messages `withCurrentDocContext` seeds ahead of the real conversation:
 * the document context, then the greeting. They're part of what the model
 * reads but not part of what the writer sees, so the transcript is rendered
 * from this offset on.
 */
const SEEDED_MESSAGE_COUNT = 2;

/**
 * Renders the document context into the message the model reads.
 *
 * `brief` is the writer's document brief, already prompt-formatted (null when
 * they haven't set one). It rides along with the document context because both
 * describe the document rather than the turn, and both are refreshed together
 * on every send.
 */
export function docContextMessageContent(
	docContext: DocContext,
	brief: string | null = null,
): string {
	const document =
		docContext.selectedText === ''
			? `Here is my document, with the current cursor position marked with <<CURSOR>>:\n\n${docContext.beforeCursor}${docContext.selectedText}<<CURSOR>>${docContext.afterCursor}`
			: `Here is my document, with the current selection marked with <<SELECTION>> tags:\n\n${docContext.beforeCursor}<<SELECTION>>${docContext.selectedText}<</SELECTION>>${docContext.afterCursor}`;
	return brief ? `${brief}\n\n${document}` : document;
}

/**
 * Builds the base conversation with the freshest document context as its first
 * message. When the chat is empty it seeds the doc-context + greeting
 * messages; otherwise it replaces the existing doc-context message so the
 * model always sees the current document state at send time.
 */
export function withCurrentDocContext(
	chatMessages: ChatMessage[],
	docContext: DocContext,
	brief: string | null = null,
): ChatMessage[] {
	const docContextMessage: ChatMessage = {
		role: 'user',
		content: docContextMessageContent(docContext, brief),
	};
	if (chatMessages.length === 0) {
		return [docContextMessage, CHAT_GREETING_MESSAGE];
	}
	const updated = chatMessages.slice();
	updated[0] = docContextMessage;
	return updated;
}

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

	// Seed the conversation once (system + doc-context + greeting) when empty.
	// The document context is pulled here and refreshed again at send time, so
	// there's no need to track selection changes continuously.
	useEffect(() => {
		if (chatMessages.length !== 0) return;
		void (async () => {
			const docContext = await refreshDocContext();
			updateChatMessages(
				withCurrentDocContext(
					[],
					docContext,
					formatDocBriefForPrompt(briefRef.current),
				),
			);
		})();
	}, [chatMessages.length, refreshDocContext, updateChatMessages]);

	const [isSendingMessage, updateSendingMessage] = useState(false);

	const [message, updateMessage] = useState('');

	const visibleMessages =
		chatMessages.length > SEEDED_MESSAGE_COUNT
			? chatMessages.slice(SEEDED_MESSAGE_COUNT)
			: [];

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

		// Pull the current document context at send time so the model sees the
		// document as it is now, then inject it as the doc-context message.
		const docContext = await refreshDocContext();
		let newMessages = [
			...withCurrentDocContext(
				chatMessages,
				docContext,
				formatDocBriefForPrompt(briefRef.current),
			),
			{ role: 'user', content: text },
			{ role: 'assistant', content: '' },
		];

		updateChatMessages(newMessages);
		setShowScrollButton(false);
		updateMessage('');

		try {
			const deltas = streamTextDeltas({
				model: languageModel,
				providerOptions: openaiProviderOptions,
				instructions: CHAT_INSTRUCTIONS,
				messages: newMessages.slice(0, -1) as ModelMessage[],
				abortSignal: requestController.signal,
			});

			for await (const delta of deltas) {
				// Need to make a new object to force React to update.
				newMessages = newMessages.slice();
				newMessages[newMessages.length - 1].content += delta;
				updateChatMessages(newMessages);
			}
			chatLog.responseCompleted(log, {
				responseLength:
					newMessages[newMessages.length - 1].content.length,
			});
		} catch (error) {
			if (requestController.signal.aborted) {
				return;
			}
			const info = describeGenerationError(error);
			console.error('Error while streaming chat response:', error);
			// Nothing streamed: roll the turn back (empty assistant bubble + the
			// user message it was answering) and hand the text back to the input
			// box, so Retry re-sends it once rather than duplicating the turn.
			// If part of a reply did arrive, keep it and just show the error under it.
			if (newMessages[newMessages.length - 1].content === '') {
				updateChatMessages(newMessages.slice(0, -2));
				updateMessage(text);
				setFailedMessage({ text, source });
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
			}
		}
	}

	function startNewConversation() {
		activeRequestControllerRef.current?.abort();
		activeRequestControllerRef.current = null;
		updateSendingMessage(false);
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
								chatMessage.content === '' &&
								isSendingMessage;

							return (
								<div
									key={index + SEEDED_MESSAGE_COUNT}
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
													{chatMessage.content}
												</DocTextMarkdown>
											) : (
												chatMessage.content
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
