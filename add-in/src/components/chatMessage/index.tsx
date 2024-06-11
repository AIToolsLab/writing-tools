import { Remark } from 'react-remark';

import classes from './styles.module.css';

type ChatMessageProps = {
	index: number;
	refresh: (_: number) => void;
	deleteMessage: (_: number) => void;
	convertToComment: (_: number) => void;
};

export default function ChatMessage(props: ChatMessage & ChatMessageProps) {
	return (
		<div className={ classes.container }>
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
