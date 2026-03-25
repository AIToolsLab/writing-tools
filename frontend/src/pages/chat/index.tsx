import { useState, useContext, useEffect, useRef, useCallback } from 'react';
import { Remark } from 'react-remark';

import { AiOutlineArrowDown, AiOutlineSend } from 'react-icons/ai';
import { fetchEventSource } from '@microsoft/fetch-event-source';

import { ChatContext } from '@/contexts/chatContext';
import { usernameAtom } from '@/contexts/userContext';
import { EditorContext } from '@/contexts/editorContext';

import { SERVER_URL } from '@/api';

import { useAccessToken } from '@/contexts/authTokenContext';
import { useAtomValue } from 'jotai';
import { useDocContext } from '@/utilities';
import classes from './styles.module.css';

const suggestionPrompts = [
	'What is my main argument?',
	'How can I improve clarity?',
	'Is my structure logical?',
	'What am I missing?',
];

export default function Chat() {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	const username = useAtomValue(usernameAtom);
	const editorAPI = useContext(EditorContext);
	const { getAccessToken, authErrorType } = useAccessToken();
	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [showScrollButton, setShowScrollButton] = useState(false);

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

	// Auto-scroll when new messages arrive
	useEffect(() => {
		if (!showScrollButton) {
			messagesContainerRef.current?.scrollTo({
				top: messagesContainerRef.current.scrollHeight,
				behavior: 'smooth',
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [chatMessages]);

	const docContext = useDocContext(editorAPI);

	const docContextMessageContent =
		docContext.selectedText === ''
			? `Here is my document, with the current cursor position marked with <<CURSOR>>:\n\n${docContext.beforeCursor}${docContext.selectedText}<<CURSOR>>${docContext.afterCursor}`
			: `Here is my document, with the current selection marked with <<SELECTION>> tags:\n\n${docContext.beforeCursor}<<SELECTION>>${docContext.selectedText}<</SELECTION>>${docContext.afterCursor}`;

	let messagesWithCurDocContext = chatMessages;
	if (chatMessages.length === 0) {
		// Initialize the chat with the system message and the document-context message.
		const systemMessage = {
			role: 'system',
			content:
				'Help the user improve their writing. Encourage the user towards critical thinking and self-reflection. Be concise. If the user mentions "here" or "this", assume they are referring to the area near the cursor or selection.',
		};

		const docContextMessage = {
			role: 'user',
			content: docContextMessageContent,
		};

		const initialAssistantMessage = {
			role: 'assistant',
			content: 'What do you think about your document so far?',
		};
		messagesWithCurDocContext = [
			systemMessage,
			docContextMessage,
			initialAssistantMessage,
		];
	} else {
		// Update the document context message with the current selection.
		messagesWithCurDocContext[1].content = docContextMessageContent;
	}
	useEffect(() => {
		updateChatMessages(messagesWithCurDocContext);
	}, [messagesWithCurDocContext, updateChatMessages]);

	const [isSendingMessage, updateSendingMessage] = useState(false);

	const [message, updateMessage] = useState('');

	const visibleMessages =
		messagesWithCurDocContext.length > 3 ? messagesWithCurDocContext.slice(3) : [];

	const resizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
	}, []);

	useEffect(() => {
		resizeTextarea();
	}, [message, resizeTextarea]);

	async function submitMessage(text: string) {
		updateSendingMessage(true);

		let newMessages = [
			...messagesWithCurDocContext,
			{ role: 'user', content: text },
			{ role: 'assistant', content: '' },
		];

		updateChatMessages(newMessages);
		setShowScrollButton(false);
		updateMessage('');

		const token = await getAccessToken();
		await fetchEventSource(`${SERVER_URL}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				messages: newMessages.slice(0, -1),
				username: username,
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];
				if (choice.finish_reason === 'stop') return;
				const newContent = choice.delta.content;
				// need to make a new "newMessages" object to force React to update :(
				newMessages = newMessages.slice();
				newMessages[newMessages.length - 1].content += newContent;
				updateChatMessages(newMessages);
			},
		});

		updateSendingMessage(false);
	}

	async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const trimmedMessage = message.trim();
		if (!trimmedMessage) return;

		await submitMessage(trimmedMessage);
	}

	async function sendSuggestedMessage(text: string) {
		updateMessage(text);
		await submitMessage(text);
	}

	if (authErrorType !== null) {
		return <div>Please reauthorize.</div>;
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
							<div className={classes.chatWelcomeIcon}>💬</div>
							<div className={classes.chatWelcomeTitle}>Ask about your document</div>
							<div className={classes.chatWelcomeHint}>
								Ask questions, get explanations, or explore ideas about what you're writing.
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
