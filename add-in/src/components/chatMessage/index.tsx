import React from 'react';

import { ChatMessage } from '../../pages/chat';

import classes from './styles.module.css';

export default function ChatMessage(props: ChatMessage) {
    return (
        <p>
            from: {props.role} - {props.content}
        </p>
    );
}
