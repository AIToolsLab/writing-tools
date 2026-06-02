'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AiOutlineArrowDown, AiOutlineSend } from 'react-icons/ai';
import { Remark } from 'react-remark';
import { ChatContext } from '@/contexts/chatContext';
import { EditorContext } from '@/contexts/editorContext';
import { useDocContext } from '@/lib/useDocContext';
import classes from './Chat.module.css';

const suggestionPrompts = [
	'What is my main argument?',
	'How can I improve clarity?',
	'Is my structure logical?',
	'What am I missing?',
];

// Extract the plain text from a UI message's parts.
function getMessageText(message: UIMessage): string {
	return message.parts
		.filter((part) => part.type === 'text')
		.map((part) => (part as { text: string }).text)
		.join('');
}

export default function Chat() {
	const editorAPI = useContext(EditorContext);
	const docContext = useDocContext(editorAPI);
	const { chatMessages, updateChatMessages } = useContext(ChatContext);

	const { messages, sendMessage, status, setMessages } = useChat({
		transport: new DefaultChatTransport({ api: '/api/chat' }),
	});

	const messagesContainerRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const [showScrollButton, setShowScrollButton] = useState(false);
	const [message, updateMessage] = useState('');

	const isSendingMessage = status === 'submitted' || status === 'streaming';

	// Seed from the persisted context once, when this panel mounts empty.
	const hasSeededRef = useRef(false);
	useEffect(() => {
		if (!hasSeededRef.current && messages.length === 0 && chatMessages.length > 0) {
			hasSeededRef.current = true;
			setMessages(chatMessages);
		}
	}, [messages.length, chatMessages, setMessages]);

	// Persist meaningful messages back to the context so they survive tab switches.
	useEffect(() => {
		const meaningful = messages.filter((m) => getMessageText(m).trim() !== '');
		if (meaningful.length > 0) {
			updateChatMessages(messages);
		}
	}, [messages, updateChatMessages]);

	// Show the "scroll to bottom" button when the user scrolls up.
	const handleScroll = useCallback(() => {
		const container = messagesContainerRef.current;
		if (!container) return;
		const isNearBottom =
			container.scrollHeight - container.scrollTop - container.clientHeight < 100;
		setShowScrollButton(!isNearBottom);
	}, []);

	const scrollToBottom = useCallback(() => {
		const container = messagesContainerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
		}
	}, []);

	// Auto-scroll when new messages arrive (unless the user scrolled up).
	useEffect(() => {
		if (!showScrollButton) {
			messagesContainerRef.current?.scrollTo({
				top: messagesContainerRef.current.scrollHeight,
				behavior: 'smooth',
			});
		}
	}, [messages, showScrollButton]);

	const resizeTextarea = useCallback(() => {
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.style.height = 'auto';
		textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
	}, []);

	useEffect(() => {
		resizeTextarea();
	}, [message, resizeTextarea]);

	const submitMessage = useCallback(
		(text: string) => {
			setShowScrollButton(false);
			updateMessage('');
			// Send the current document context fresh with each turn.
			void sendMessage({ text }, { body: { docContext } });
		},
		[sendMessage, docContext],
	);

	function sendCurrentMessage(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const trimmedMessage = message.trim();
		if (!trimmedMessage) return;
		submitMessage(trimmedMessage);
	}

	const visibleMessages = messages.filter((m) => getMessageText(m).trim() !== '');

	return (
		<div className={classes.app}>
			<div className={classes.chatPanel}>
				<div ref={messagesContainerRef} onScroll={handleScroll} className={classes.chatBody}>
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
										onClick={() => submitMessage(prompt)}
										className={classes.chatSuggChip}
									>
										{prompt}
									</button>
								))}
							</div>
						</div>
					) : (
						visibleMessages.map((chatMessage) => {
							const text = getMessageText(chatMessage);
							return (
								<div
									key={chatMessage.id}
									className={`${classes.chatMsg} ${chatMessage.role === 'user' ? classes.user : classes.ai}`}
								>
									{chatMessage.role === 'assistant' ? (
										<div className={classes.chatMeta}>Assistant</div>
									) : null}

									<div className={classes.chatBubble}>
										{chatMessage.role === 'assistant' ? <Remark>{text}</Remark> : text}
									</div>

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

			<form className={classes.chatFoot} onSubmit={sendCurrentMessage}>
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
