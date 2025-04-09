import { useState, useContext, useEffect } from 'react';

import { AiOutlineSend } from 'react-icons/ai';
import { fetchEventSource } from '@microsoft/fetch-event-source';

import ChatMessage from '@/components/chatMessage';

import { ChatContext } from '@/contexts/chatContext';
import { UserContext } from '@/contexts/userContext';

import { SERVER_URL } from '@/api';

import classes from './styles.module.css';
import { getCurParagraph } from '@/utilities/selectionUtil';

export default function Chat({ editorAPI }: { editorAPI: EditorAPI }) {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	const { username } = useContext(UserContext);

	/* Document Context (FIXME: make this a hook) */
	const {
		addSelectionChangeHandler,
		removeSelectionChangeHandler,
		getDocContext
	} = editorAPI;
	const [docContext, updateDocContext] = useState<DocContext>({
		beforeCursor: '',
		selectedText: '',
		afterCursor: ''
	});

	async function handleSelectionChanged(): Promise<void> {
		const newDocContext = await getDocContext();
		updateDocContext(newDocContext);
		updateChatMessagesWithDocContext(newDocContext);
	}

	function updateChatMessagesWithDocContext(newDocContext: DocContext) {
		const docContextMessageContent = (
			docContext.selectedText === ''
				? `Here is my document, with the current cursor position marked with <<CURSOR>>: ${newDocContext.beforeCursor}${newDocContext.selectedText}<<CURSOR>>${newDocContext.afterCursor}`
				: `Here is my document, with the current selection marked with <<CURSOR>>: ${newDocContext.beforeCursor}<<CURSOR>>${newDocContext.selectedText}<<CURSOR>>${newDocContext.afterCursor}`
		);
	

		let newMessages = chatMessages;
		if (chatMessages.length === 0) {
			// Initialize the chat with the system message and the document-context message.
			const systemMessage = {
				role: 'system',
				content:
					'Help the user improve their writing. Encourage the user towards critical thinking and self-reflection. Be concise.'
			};

			const docContextMessage = {
				role: 'user',
				content: docContextMessageContent
			};

			const initialAssistantMessage = {
				role: 'assistant',
				content: "What do you think about your document so far?"
			};
			newMessages = [systemMessage, docContextMessage, initialAssistantMessage];
		} else {
			// Update the document context message with the current selection.
			newMessages[1].content = docContextMessageContent;
		}
		updateChatMessages(newMessages);
	}

	useEffect(() => {
		addSelectionChangeHandler(handleSelectionChanged);
		// Initial call to set the initial state
		handleSelectionChanged();
		return () => {
			removeSelectionChangeHandler(handleSelectionChanged);
		};
	}, [addSelectionChangeHandler, removeSelectionChangeHandler]);


	const [isSendingMessage, updateSendingMessage] = useState(false);

	const [message, updateMessage] = useState('');

	async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		if (!message) return;

		updateSendingMessage(true);

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
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];
				if (choice.finish_reason === 'stop') return;
				const newContent = choice.delta.content;
				// need to make a new "newMessages" object to force React to update :(
				newMessages = newMessages.slice();
				newMessages[newMessages.length - 1].content += newContent;
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
