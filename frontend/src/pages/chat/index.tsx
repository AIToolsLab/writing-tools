import { useState, useContext, useEffect } from 'react';

import { AiOutlineSend } from 'react-icons/ai';
import { fetchEventSource } from '@microsoft/fetch-event-source';

import ChatMessage from '@/components/chatMessage';

import { ChatContext } from '@/contexts/chatContext';
import { UserContext } from '@/contexts/userContext';
import { EditorContext } from '@/contexts/editorContext';

import { SERVER_URL } from '@/api';

import classes from './styles.module.css';
import { useAccessToken } from '@/contexts/authTokenContext';

export default function Chat() {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	const { username } = useContext(UserContext);
	const editorAPI = useContext(EditorContext);
	const { getAccessToken, reportAuthError, authErrorType } = useAccessToken();

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
	}

	const docContextMessageContent = (
		docContext.selectedText === ''
			? `Here is my document, with the current cursor position marked with <<CURSOR>>:\n\n${docContext.beforeCursor}${docContext.selectedText}<<CURSOR>>${docContext.afterCursor}`
			: `Here is my document, with the current selection marked with <<SELECTION>> tags:\n\n${docContext.beforeCursor}<<SELECTION>>${docContext.selectedText}<</SELECTION>>${docContext.afterCursor}`
	);

	let messagesWithCurDocContext = chatMessages;
	if (chatMessages.length === 0) {
		// Initialize the chat with the system message and the document-context message.
		const systemMessage = {
			role: 'system',
			content:
				'Help the user improve their writing. Encourage the user towards critical thinking and self-reflection. Be concise. If the user mentions "here" or "this", assume they are referring to the area near the cursor or selection.'
		};

		const docContextMessage = {
			role: 'user',
			content: docContextMessageContent
		};

		const initialAssistantMessage = {
			role: 'assistant',
			content: 'What do you think about your document so far?'
		};
		messagesWithCurDocContext = [systemMessage, docContextMessage, initialAssistantMessage];
	}
 		else {
			// Update the document context message with the current selection.
			messagesWithCurDocContext[1].content = docContextMessageContent;
		}
	useEffect(() => {
		updateChatMessages(messagesWithCurDocContext);
	}, [messagesWithCurDocContext, updateChatMessages]);

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
			...messagesWithCurDocContext,
			{ role: 'user', content: message },
			{ role: 'assistant', content: '' }
		];

		updateChatMessages(newMessages);

		const token = await getAccessToken();
		await fetchEventSource(`${SERVER_URL}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`
			},
			body: JSON.stringify({
				messages: newMessages.slice(0, -1),
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
		const token = await getAccessToken();
		const response = await fetch(`${SERVER_URL}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${token}`
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

	if (authErrorType !== null) {
        return (
            <div>
							Please reauthorize.
						</div>
        );
    }

	return (
		<div className={ classes.container }>
			<div className={ classes.messageContainer }>
				{ messagesWithCurDocContext.slice(2).map((message, index) => (
					<ChatMessage
						key={ index + 2 }
						role={ message.role }
						content={ message.content }
						index={ index + 2 }
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
