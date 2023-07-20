import React from 'react';
import { TextField } from '@fluentui/react';
import { AiOutlineSend } from 'react-icons/ai';

import ChatMessage from '../../components/chatMessage';
import PresetPrompts from '../../components/presetPrompts';

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

        const response = await fetch(`${SERVER_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                messages: messages,
            }),
        });

        const responseJson = await response.json();

        updateMessages([
            ...messages,
            {
                role: 'user',
                content: message,
            },
            {
                role: 'assistant',
                content: responseJson,
            },
        ]);

        updateSendingMessage(false);
        updateMessage('');
    }

    // ! Consider appending prompt to current message

    return (
        <div className={classes.container}>
            <PresetPrompts
                updatePrompt={(prompt) =>
                    updateMessage(message + '\n\n' + prompt)
                }
            />

            <div className={classes.messageContainer}>
                {messages.map((message, index) => (
                    <ChatMessage
                        key={index}
                        role={message.role}
                        content={message.content}
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
