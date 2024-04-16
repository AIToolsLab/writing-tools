import { Remark } from 'react-remark';

import classes from './styles/ChatMessage.module.css';

type ChatMessageProps = {
	index: number;
	refresh: (_: number) => void;
	deleteMessage: (_: number) => void;
	convertToComment: (_: number) => void;
};

export default function ChatMessage(props: ChatMessage & ChatMessageProps) {
	return (
		<div className={ classes.container }>
			{ /*
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
                )*/ }

			<div
				className={ `${classes.cardContainer} ${
					props.role === 'user' ? classes.noBorderBottom : ''
				}` }
			>
				<div className={ classes.pfpContainer }>
					{ props.role === 'user' ? (
						<img
							src="https://source.boringavatars.com/marble/30/Maria%20user"
							alt="User"
						/>
					) : (
						<div className={ classes.pfp } />
					) }
				</div>

				<div>
					<Remark>{ props.content }</Remark>
				</div>
			</div>
		</div>
	);
}
