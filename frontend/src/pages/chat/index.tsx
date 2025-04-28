import { useState, useContext, useEffect } from 'react';

import { AiOutlineSend } from 'react-icons/ai';
import { fetchEventSource } from '@microsoft/fetch-event-source';
import { FaLightbulb, FaSearch } from 'react-icons/fa';

import ChatMessage from '@/components/chatMessage';

import { ChatContext } from '@/contexts/chatContext';
import { UserContext } from '@/contexts/userContext';
import { EditorContext } from '@/contexts/editorContext';

import { SERVER_URL } from '@/api';

import classes from './styles.module.css';

export default function Chat() {
	const { chatMessages, updateChatMessages } = useContext(ChatContext);
	const { username } = useContext(UserContext);
	const editorAPI = useContext(EditorContext);

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
				content: 'What do you think about your document so far?'
			};
			newMessages = [systemMessage, docContextMessage, initialAssistantMessage];
		}
 		else {
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
				console.log('Server response message:', message);
				
				if (message.type === 'web_search_call') {
					console.log('Web search response:', message);
					return;
				}
				
				if (message.type === 'message') {
					console.log('Message content:', message.content);
					if (message.content && message.content.length > 0 && message.content[0].type === 'output_text') {
						const textContent = message.content[0].text;
						const annotations = message.content[0].annotations || [];
						console.log('Annotations:', annotations);
						
						newMessages = newMessages.slice();
						newMessages[newMessages.length - 1].content = textContent;
						updateChatMessages(newMessages);
					}
					return;
				}
				
				if (message.choices && message.choices[0]) {
					const choice = message.choices[0];
					if (choice.finish_reason === 'stop') return;
					
					if (choice.delta && choice.delta.content) {
						const newContent = choice.delta.content;
						newMessages = newMessages.slice();
						newMessages[newMessages.length - 1].content += newContent;
						updateChatMessages(newMessages);
					}
				}
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

	async function suggestExamples() {
		const newDocContext = await getDocContext();
		updateDocContext(newDocContext);
		
		const userMessage = {
			role: 'user',
			content: 'Please suggest examples that would fit into my text at the cursor position.'
		};
		
		const systemPrompt = 
			'I am writing an essay, and you will generate a list of examples that fit into my text. The example will be generated on the cursor position <<CURSOR>>\n' +
			'You will receive my ongoing essay text.\n' +
			'Based on the given text, ask me what kind of examples I am looking for.\n' +
			'Then, generate a concise and brief description list of possible examples. Examples MUST be REAL and SPECIFIC.\n\n' +
			'Format your response as a numbered list. For EACH example:\n' +
			'1. Give a clear, brief title for the example\n' + 
			'2. Provide a 1 sentence description\n' +
			'3. For each example, include a reference in the format: (Source: name of source or website)\n\n' +
			'IMPORTANT: Format each example exactly like this:\n' +
			'1. Example Title: Brief description of the example. (Source: Name of Organization or Publication)\n' +
			'2. Another Example Title: Brief description of another example. (Source: Name of Another Source)\n\n' +
			'Be concise but specific in your examples. Examples should be factual and realistic.';
		
		let newMessages = [
			...chatMessages,
			userMessage,
			{ role: 'assistant', content: '' }
		];
		
		updateChatMessages(newMessages);
		updateSendingMessage(true);
		
		await fetchEventSource(`${SERVER_URL}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				messages: [
					{ role: 'system', content: systemPrompt },
					{ 
						role: 'user', 
						content: `Here is my document, with the current cursor position marked with <<CURSOR>>: ${newDocContext.beforeCursor}<<CURSOR>>${newDocContext.afterCursor}`
					}
				],
				username: username
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				console.log('Server response message:', message);
				
				if (message.type === 'web_search_call') {
					console.log('Web search response:', message);
					return;
				}
				
				if (message.type === 'message') {
					console.log('Message content:', message.content);
					if (message.content && message.content.length > 0 && message.content[0].type === 'output_text') {
						const textContent = message.content[0].text;
						const annotations = message.content[0].annotations || [];
						console.log('Annotations:', annotations);
						
						newMessages = newMessages.slice();
						newMessages[newMessages.length - 1].content = textContent;
						updateChatMessages(newMessages);
					}
					return;
				}
				
				if (message.choices && message.choices[0]) {
					const choice = message.choices[0];
					if (choice.finish_reason === 'stop') return;
					
					if (choice.delta && choice.delta.content) {
						const newContent = choice.delta.content;
						newMessages = newMessages.slice();
						newMessages[newMessages.length - 1].content += newContent;
						updateChatMessages(newMessages);
					}
				}
			}
		});
		
		updateSendingMessage(false);
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

			<div className={ classes.controlsContainer }>
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

				<div className={ classes.buttonContainer }>
					<button
						onClick={ suggestExamples }
						className={ classes.exampleButton }
						disabled={ isSendingMessage }
					>
						<FaLightbulb /> 
						<FaSearch />
						<span>Example Suggestions</span>
					</button>
					
					<button
						onClick={ () => updateChatMessages([]) }
						className={ classes.clearChat }
					>
						Clear Chat
					</button>
				</div>
			</div>
		</div>
	);
}
