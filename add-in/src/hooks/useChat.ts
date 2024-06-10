import { fetchEventSource } from '@microsoft/fetch-event-source';

export function useChat({ SERVER_URL, chatMessages, updateChatMessages, username}: 
	{ SERVER_URL: string, chatMessages: any, updateChatMessages: any, username: string}
) {
	async function append(message: string, messages: any[] = chatMessages) {

		if (!message) return;

		let newMessages = [
			...messages,
			{ role: 'user', content: message },
			{ role: 'assistant', content: '', done: false }
		];

		updateChatMessages(newMessages);

		await fetchEventSource(`${SERVER_URL}/chat`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				messages: newMessages.slice(0, -1),
				username: username
			}),
			onmessage(msg) {
				const message = JSON.parse(msg.data);
				const choice = message.choices[0];
                // need to make a new "newMessages" object to force React to update :(
                newMessages = newMessages.slice();

				if (choice.finish_reason === 'stop') {
                    newMessages[newMessages.length - 1].done = true;
                } else {
    				const newContent = choice.delta.content;
				    newMessages[newMessages.length - 1].content += newContent;
                }
				updateChatMessages(newMessages);
			},
            onerror(err) {
                console.error(err);
                // rethrow to avoid infinite retry.
                throw err;
            }
		});

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

	return { append, regenMessage };
}
