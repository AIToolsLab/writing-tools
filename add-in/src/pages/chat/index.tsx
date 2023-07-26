import React from 'react';
import { AiOutlineSend } from 'react-icons/ai';

import ChatMessage from '../../components/chatMessage';

import { SERVER_URL } from '../../settings';

import classes from './styles.module.css';

export type ChatMessage = {
    role: string;
    content: string;
};

export default function Chat() {
    const [messages, updateMessages] = React.useState<ChatMessage[]>([]);
    const [isSendingMessage, updateSendingMessage] = React.useState(false);

    const [message, updateMessage] = React.useState('');

    async function sendMessage(e) {
        updateSendingMessage(true);
        e.preventDefault();

        if (!message) return;

        const prevNumMessages = messages.length;
        
        updateMessages([
            ...messages,
            { role: 'user', content: message }
        ]);
        
        let newMessages = [...messages, { role: 'user', content: message }];

        const response = await fetch(`${SERVER_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: [
                    ...messages,
                    { role: 'user', content: message }
                ],
            }),
        });

        // Read the response as a stream
        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');

        while (true) {
            const {done, value} = await reader.read();
            if (done) break;
            
            const decoded = decoder.decode(value);
            const decodedMessage = decoded.replaceAll('\r', '').replaceAll('data: ', '');
            
            if(newMessages[newMessages.length - 1].role === 'assistant') {
                const tempMessages = [...newMessages];
                tempMessages[tempMessages.length - 1].content += decodedMessage;
                
                newMessages = tempMessages;
                updateMessages(newMessages);
            }
            else {
                const tempMessages = [
                    ...newMessages,
                    {
                        role: 'assistant',
                        content: decodedMessage
                    }
                ];

                newMessages = tempMessages;
                updateMessages(tempMessages);
            }
        }

        updateSendingMessage(false);
        updateMessage('');
    }

    async function regenMessage(index: number) {
        // Resubmit the conversation up until the last message,
        // so it regenerates the last assistant message.
        const response = await fetch(`${SERVER_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: messages.slice(0, index),
            }),
        });

        const responseJson = await response.json();

        const newMessages = [...messages];
        newMessages[index + 1] = {
            role: 'assistant',
            content: responseJson,
        };

        updateMessages(newMessages);
    }

    return (
        <div className={classes.container}>
            <div className={classes.messageContainer}>
                {messages.map((message, index) => (
                    <ChatMessage
                        key={index}
                        role={message.role}
                        content={message.content}
                        index={index}
                        refresh={regenMessage}
                        deleteMessage={() => {}}
                        convertToComment={() => {}}
                    />
                ))}
            </div>

            <form className={classes.sendMessage} onSubmit={sendMessage}>
                <label className={classes.label}>
                    <textarea
                        disabled={isSendingMessage}
                        placeholder="Send a message"
                        value={message}
                        onChange={(e) =>
                            updateMessage((e.target as HTMLTextAreaElement).value)
                        }
                        className={classes.messageInput}
                    />

                    <button type="submit">
                        <AiOutlineSend />
                    </button>
                </label>
            </form>
        </div>
    );
}
