import { type ModelMessage } from 'ai';
import {
	useCallback,
	useContext,
	useEffect,
	useEffectEvent,
	useRef,
	useState,
} from 'react';
import { AiOutlineArrowDown, AiOutlineSend } from 'react-icons/ai';
import { Remark } from 'react-remark';

import {
	describeGenerationError,
	type GenerationErrorInfo,
} from '@/api/errors';
import { streamTextDeltas } from '@/api/generate';
import { chatLog } from '@/api/logging';
import { languageModel, openaiProviderOptions } from '@/api/openai';
import { GenerationErrorNotice } from '@/components/errorNotice';
import { ChatContext } from '@/contexts/chatContext';
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

const CHAT_SYSTEM_MESSAGE: ChatMessage = {
	role: 'system',
	content:
		'Help the user improve their writing. Encourage the user towards critical thinking and self-reflection. Be concise. If the user mentions "here" or "this", assume they are referring to the area near the cursor or selection.',
};

const CHAT_GREETING_MESSAGE: ChatMessage = {
	role: 'assistant',
	content: 'What do you think about your document so far?',
};

/** Renders the document context into the message the model reads. */
export function docContextMessageContent(docContext: DocContext): string {
	return docContext.selectedText === ''
		? `Here is my document, with the current cursor position marked with <<CURSOR>>:\n\n${docContext.beforeCursor}${docContext.selectedText}<<CURSOR>>${docContext.afterCursor}`
		: `Here is my document, with the current selection marked with <<SELECTION>> tags:\n\n${docContext.beforeCursor}<<SELECTION>>${docContext.selectedText}<</SELECTION>>${docContext.afterCursor}`;
}

/**
 * Builds the base conversation with the freshest document context as its
 * second message. When the chat is empty it seeds the system + doc-context +
 * greeting messages; otherwise it replaces the existing doc-context message so
 * the model always sees the current document state at send time.
 */
export function withCurrentDocContext(
	chatMessages: ChatMessage[],
	docContext: DocContext,
): ChatMessage[] {
	const docContextMessage: ChatMessage = {
		role: 'user',
		content: docContextMessageContent(docContext),
	};
	if (chatMessages.length === 0) {
		return [CHAT_SYSTEM_MESSAGE, docContextMessage, CHAT_GREETING_MESSAGE];
	}
	const updated = chatMessages.slice();
	updated[1] = docContextMessage;
	return updated;
}

export default function Chat() {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	const editorAPI = useContext(EditorContext);
	const log = useLog();
	const activeRequestControllerRef = useRef<AbortController | null>(null);
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [showScrollButton, setShowScrollButton] = useState(false);
	const [errorInfo, setErrorInfo] = useState<GenerationErrorInfo | null>(null);
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
		const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
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

	// Seed the conversation once (system + doc-context + greeting) when empty.
	// The document context is pulled here and refreshed again at send time, so
	// there's no need to track selection changes continuously.
	useEffect(() => {
		if (chatMessages.length !== 0) return;
		void (async () => {
			const docContext = await refreshDocContext();
			updateChatMessages(withCurrentDocContext([], docContext));
		})();
	}, [chatMessages.length, refreshDocContext, updateChatMessages]);

	const [isSendingMessage, updateSendingMessage] = useState(false);

	const [message, updateMessage] = useState('');

	const visibleMessages =
		chatMessages.length > 3 ? chatMessages.slice(3) : [];

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
			...withCurrentDocContext(chatMessages, docContext),
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
				messages: newMessages.slice(0, -1) as ModelMessage[],
				maxOutputTokens: 1024,
				abortSignal: requestController.signal,
			});

			for await (const delta of deltas) {
				// Need to make a new object to force React to update.
				newMessages = newMessages.slice();
				newMessages[newMessages.length - 1].content += delta;
				updateChatMessages(newMessages);
			}
			chatLog.responseCompleted(log, {
				responseLength: newMessages[newMessages.length - 1].content.length,
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
			<div className={classes.chatPanel}>
				<div
					ref={messagesContainerRef}
					onScroll={handleScroll}
					className={classes.chatBody}
				>
					{visibleMessages.length === 0 ? (
						<div className={classes.chatWelcome}>
							
							<div className={classes.chatWelcomeTitle}>What do you think about your document so far?</div>

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
								chatMessage.role === 'assistant' && chatMessage.content === '' && isSendingMessage;

							return (
								<div
									key={index + 3}
									className={`${classes.chatMsg} ${chatMessage.role === 'user' ? classes.user : classes.ai}`}
								>
									{chatMessage.role === 'assistant' ? (
										<div className={classes.chatMeta}>Assistant</div>
									) : null}

									{isAssistantTyping ? (
										<div className={classes.typingIndicator}>
											<span />
											<span />
											<span />
										</div>
									) : (
										<div className={classes.chatBubble}>
											{chatMessage.role === 'assistant' ? (
												<Remark>{chatMessage.content}</Remark>
											) : (
												chatMessage.content
											)}
										</div>
									)}

									{chatMessage.role === 'user' ? (
										<div className={classes.chatMeta}>You</div>
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
											void submitMessage(failedMessage.text, failedMessage.source)
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
