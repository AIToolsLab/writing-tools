import { useState, useContext } from 'react';

import { AiOutlineSend } from 'react-icons/ai';

import ChatMessage from '@/components/chatMessage';

import { ChatContext } from '@/contexts/chatContext';
import { UserContext } from '@/contexts/userContext';

import { SERVER_URL } from '@/api';

import { useChat } from '@/hooks/useChat';

import classes from './styles.module.css';


export default function Chat() {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	
	const { username } = useContext(UserContext);
	
	const { append, regenMessage } = useChat({
		SERVER_URL,
		chatMessages, updateChatMessages,
		username
	});

	const [isSendingMessage, updateSendingMessage] = useState(false);

	const [message, updateMessage] = useState('');

	async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
		updateSendingMessage(true);
		e.preventDefault();
		// streaming updates happen inplicitly because ''append' calls 'updateChatMessages'
		await append(message);
		updateSendingMessage(false);
		updateMessage('');
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
