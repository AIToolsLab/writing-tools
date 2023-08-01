import React from 'react';
import { FiRefreshCcw, FiTrash2 } from 'react-icons/fi';
import { TfiCommentAlt } from 'react-icons/tfi';

import { ChatMessage } from '../../pages/chat';

import classes from './styles.module.css';

type ChatMessageProps = {
    index: number;
    refresh: (_: number) => void;
    deleteMessage: (_: number) => void;
    convertToComment: (_: number) => void;
}

export default function ChatMessage(
    props: ChatMessage & ChatMessageProps
) {
    return (
        <div className={classes.container}>
            {/*
                props.role !== 'assistant' ? (
                    <div className={ classes.toolbar }>
                        <FiRefreshCcw
                            className={classes.icon}
                            onClick={() => props.refresh(props.index)}
                        />
                    </div>
                ) : (
                    <div className={ classes.toolbar }>
                        <FiTrash2
                            className={classes.icon}
                            onClick={() => props.deleteMessage(props.index)}
                        />

                        <TfiCommentAlt
                            className={classes.icon}
                            onClick={() => props.convertToComment(props.index)}
                        />
                    </div>
                )*/
            }

            <div
                className={
                    `${classes.cardContainer} ${ props.role === 'user' ? classes.noBorderBottom : '' }`
                }
            >
                <div className={ classes.pfpContainer }>
                    {
                        props.role === 'user' ? (
                            <img
                                src="https://source.boringavatars.com/marble/30/Maria%20user"
                                alt="User"
                            />
                        ) : (
                            <div className={ classes.pfp } />
                        )
                    }
                </div>

                {props.content}
            </div>
        </div>
    );
}
