import { useState, useContext } from 'react';

import { AiOutlineSend } from 'react-icons/ai';
import { fetchEventSource } from '@microsoft/fetch-event-source';

import ChatMessage from '@/components/chatMessage';

import { ChatContext } from '@/contexts/chatContext';
import { UserContext } from '@/contexts/userContext';

import { SERVER_URL } from '@/api';

import classes from './styles.module.css';

export default function Chat() {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	const { username } = useContext(UserContext);

	const [isSendingMessage, updateSendingMessage] = useState(false);

	const [message, updateMessage] = useState('');

	async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
		updateSendingMessage(true);
		e.preventDefault();

		if (!message) return;

		let newMessages = [
			...chatMessages,
			{ role: 'user', content: message },
			{ role: 'assistant', content: '' }
		];

		updateChatMessages(newMessages);

		await fetchEventSource(`${SERVER_URL}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				messages: [...chatMessages, { role: 'user', content: message }],
				username: username
			}),
			onmessage(msg) {
				const message = msg.data;

				const tempMessages = [...newMessages];
				tempMessages[tempMessages.length - 1].content += message;

				newMessages = tempMessages;
				updateChatMessages(newMessages);
			}
		});

		updateSendingMessage(false);

		updateMessage('');
	}

	async function regenMessage(index: number) {
		// Resubmit the conversation up until the last message,
		// so it regenerates the last assistant message.
		const response = await fetch(`${SERVER_URL}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				messages: chatMessages.slice(0, index)
			})
		});

		const responseJson = await response.json();

		const newMessages = [...chatMessages];
		newMessages[index + 1] = {
			role: 'assistant',
			content: responseJson
		};

		updateChatMessages(newMessages);
	}

	return (
		<div className={ classes.container }>
			<div className={ classes.messageContainer }>
				{ chatMessages.map((message, index) => (
					<ChatMessage
						key={ index }
						role={ message.role }
						content={ message.content }
						index={ index }
						refresh={ regenMessage }
						deleteMessage={ () => {} }
						convertToComment={ () => {} }
					/>
				)) }
			</div>

			<form
				className={ classes.sendMessage }
				onSubmit={ sendMessage }
			>
				<label className={ classes.label }>
					<textarea
						disabled={ isSendingMessage }
						placeholder="Send a message"
						value={ message }
						onChange={ e =>
							updateMessage(
								(e.target as HTMLTextAreaElement).value
							)
						}
						className={ classes.messageInput }
					/>

					<button type="submit">
						<AiOutlineSend />
					</button>
				</label>
			</form>

			<button
				onClick={ () => updateChatMessages([]) }
				className={ classes.clearChat }
			>
				Clear Chat
			</button>
		</div>
	);
}
