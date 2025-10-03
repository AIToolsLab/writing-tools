import { useState, useContext, useEffect } from 'react';

import { AiOutlineSend } from 'react-icons/ai';
import { fetchEventSource } from '@microsoft/fetch-event-source';

import ChatMessage from '@/components/chatMessage';

import { ChatContext } from '@/contexts/chatContext';
import { usernameAtom } from '@/contexts/userContext';
import { EditorContext } from '@/contexts/editorContext';

import { SERVER_URL } from '@/api';

import { useAccessToken } from '@/contexts/authTokenContext';
import { useAtomValue } from 'jotai';
import { useDocContext } from '@/utilities';

export default function Chat() {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	const username = useAtomValue(usernameAtom);
	const editorAPI = useContext(EditorContext);
	const { getAccessToken, authErrorType } = useAccessToken();

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

	async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const trimmedMessage = message.trim();
		if (!trimmedMessage) return;

		updateSendingMessage(true);

		let newMessages = [
			...messagesWithCurDocContext,
			{ role: 'user', content: trimmedMessage },
			{ role: 'assistant', content: '' },
		];

		updateChatMessages(newMessages);

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

		updateMessage('');
	}

	async function regenMessage(index: number) {
		// Resubmit the conversation up until the last message,
		// so it regenerates the last assistant message.
		const token = await getAccessToken();
		const response = await fetch(`${SERVER_URL}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${token}`,
			},
			body: JSON.stringify({
				messages: chatMessages.slice(0, index),
			}),
		});

		const responseJson = await response.json();

		const newMessages = [...chatMessages];
		newMessages[index + 1] = {
			role: 'assistant',
			content: responseJson,
		};

		updateChatMessages(newMessages);
	}

	if (authErrorType !== null) {
		return <div>Please reauthorize.</div>;
	}

	return (
		<div className="flex w-full flex-col items-center gap-6 px-4 py-6">
			<div className="flex w-full max-w-4xl flex-col gap-4">
				<div className="flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
					<div className="space-y-4 overflow-y-auto px-6 py-6 max-h-[520px]">
						{messagesWithCurDocContext.slice(2).map((message, index) => (
							<ChatMessage
								key={index + 2}
								role={message.role}
								content={message.content}
								index={index + 2}
								refresh={regenMessage}
								deleteMessage={() => {}}
								convertToComment={() => {}}
							/>
						))}
					</div>

					<form className="border-t border-slate-100 bg-slate-50/60 px-4 py-4" onSubmit={sendMessage}>
						<label className="sr-only" htmlFor="chat-input">
							Send a message
						</label>
						<div className="flex w-full items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm transition focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-200">
							<textarea
								id="chat-input"
								disabled={isSendingMessage}
								placeholder="Send a message"
								value={message}
								onChange={(e) => updateMessage(e.target.value)}
								rows={3}
								className="h-28 w-full resize-none border-none bg-transparent text-sm leading-6 text-slate-700 placeholder:text-slate-400 outline-none"
							/>
							<button
								type="submit"
								className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-sky-500 text-white shadow-sm transition hover:bg-sky-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-500 disabled:cursor-not-allowed disabled:opacity-60"
								disabled={isSendingMessage || message.trim() === ''}
								aria-label="Send message"
							>
								<AiOutlineSend className="text-lg" />
							</button>
						</div>
					</form>
				</div>

				<button
					onClick={() => updateChatMessages([])}
					className="self-end text-sm font-medium text-slate-500 transition hover:text-slate-700"
					type="button"
				>
					Clear Chat
				</button>
			</div>
		</div>
	);
}
