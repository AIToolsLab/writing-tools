import { useEffect } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';

export default async function useChat(message: string, chatMessages: ChatMessage[]) {
    if (!message) return;

    let newMessages = [
        ...chatMessages,
        { role: 'user', content: message },
        { role: 'assistant', content: '' }
    ];

    await fetchEventSource(`${SERVER_URL}/chat`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            messages: [...chatMessages, { role: 'user', content: message }],
            username: ''
        }),
        onmessage(msg) {
            const message = JSON.parse(msg.data);
            const choice = message.choices[0];
            if (choice.finish_reason === 'stop') return;
            const newContent = choice.delta.content;
            
            // need to make a new "newMessages" object to force React to update :(
            newMessages = newMessages.slice();
            newMessages[newMessages.length - 1].content += newContent;
        }
    });
}