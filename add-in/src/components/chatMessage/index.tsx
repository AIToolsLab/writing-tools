import React from 'react';

import { ChatMessage } from '../../pages/chat';

import classes from './styles.module.css';

export default function ChatMessage(props: ChatMessage) {
    return (
        <div className={classes.container}>
            <div
                className={`${classes.cardContainer}
                    ${props.role === 'assistant' ? classes.aiMessage : ''}`}
            >
                {props.content}
            </div>
        </div>
    );
}
