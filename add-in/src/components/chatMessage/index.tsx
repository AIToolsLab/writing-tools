import React from 'react';
import { FiRefreshCcw } from 'react-icons/fi';

import { ChatMessage } from '../../pages/chat';

import classes from './styles.module.css';

export default function ChatMessage(
    props: ChatMessage & { index: number; refresh: (_: number) => void }
) {
    return (
        <div className={classes.container}>
            <div
                className={`${classes.cardContainer}
                    ${props.role === 'assistant' ? classes.aiMessage : ''}`}
            >
                {props.content}

                {props.role !== 'assistant' && (
                    <FiRefreshCcw
                        className={classes.refresh}
                        onClick={() => props.refresh(props.index)}
                    />
                )}
            </div>
        </div>
    );
}
