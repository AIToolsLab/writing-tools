import React from 'react';

import { TextField } from '@fluentui/react';
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
                content: message
            },
            {
                role: 'assistant',
                content: responseJson
            }
        ]);

        updateSendingMessage(false);
        updateMessage('');
    }

    return (
        <div className={classes.container}>
            <div className={classes.messageContainer}>
                {
                    messages.map(
                        (message, index) => (
                            <ChatMessage
                                key={ index }
                                role={ message.role }
                                content={ message.content }
                            />
                        )
                    )
                }
            </div>

            <form className={classes.sendMessage} onSubmit={sendMessage}>
                <TextField
                    disabled={isSendingMessage}
                    placeholder="Send a message"
                    value={message}
                    onChange={(e) =>
                        updateMessage((e.target as HTMLInputElement).value)
                    }
                />
            </form>
        </div>
    );
}
