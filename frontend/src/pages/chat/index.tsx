import { useState, useContext, useEffect } from 'react';

import { AiOutlineClear, AiOutlineSend } from 'react-icons/ai';
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

		if (!message) return;

		updateSendingMessage(true);

		let newMessages = [
			...messagesWithCurDocContext,
			{ role: 'user', content: message },
			{ role: 'assistant', content: '' },
		];

		updateChatMessages(newMessages);
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
		<div className="m-2 flex flex-col gap-1 flex-1 overflow-hidden">
			<div className="flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
				{messagesWithCurDocContext.slice(2).map((message, index) => (
					<ChatMessage
						key={index + 2}
						role={message.role}
						content={message.content}
						index={index + 2}
						refresh={(index: number) => {
						void regenMessage(index);
					}}
						deleteMessage={() => {}}
						convertToComment={() => {}}
					/>
				))}
			</div>

			<form
			className="w-full flex flex-col"
			onSubmit={(e) => {
				void sendMessage(e);
			}}
		>
				<div className='relative'>
					<textarea
						disabled={isSendingMessage}
						placeholder="Send a message"
						value={message}
						onChange={(e) => updateMessage(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter' && !e.shiftKey) {
								e.preventDefault();
								e.currentTarget.form?.requestSubmit();
							}
						}}
						className='border border-gray-500 p-[10px] pr-[70px] w-full'
					/>
					<div className="absolute right-[8px] bottom-[8px] flex gap-1">
						<button
							type="submit"
							title="Send message"
							className="bg-transparent cursor-pointer border-none p-[5px] transition duration-150 hover:text-gray-500"
						>
							<AiOutlineSend size={18} />
						</button>
						<button
							type="button"
							title="Clear chat"
							onClick={() => updateChatMessages([])}
							className="bg-transparent cursor-pointer border-none p-[5px] text-red-500 transition duration-150 hover:text-red-700"
						>
							<AiOutlineClear size={18} />
						</button>
					</div>
				</div>
			</form>
		</div>
	);
}
