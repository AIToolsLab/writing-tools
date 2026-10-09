import Markdown from '@/components/markdown';

import classes from './styles.module.css';

type ChatMessageProps = {
	index: number;
	refresh: (_: number) => void;
	deleteMessage: (_: number) => void;
	convertToComment: (_: number) => void;
};

export default function ChatMessage(props: ChatMessage & ChatMessageProps) {
	const roleClass = props.role === 'user' ? classes.user : classes.assistant;
	return (
		<div className={`${classes.row} ${roleClass}`}>
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
                )*/}
			<div className={`${classes.bubble} ${roleClass}`}>
				<div className={classes.content}>
					<Markdown>{props.content}</Markdown>
				</div>
			</div>
		</div>
	);
}
