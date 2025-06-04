import { Remark } from 'react-remark';

type ChatMessageProps = {
	index: number;
	refresh: (_: number) => void;
	deleteMessage: (_: number) => void;
	convertToComment: (_: number) => void;
};

export default function ChatMessage(props: ChatMessage & ChatMessageProps) {
	return (
		<div className= "w-[10] relative ">
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
				className={ `$ border border-black p-[10px] flex gap-[15px] items-center ${
					props.role === 'user' ? 'border-b-0' : ''}` }
			>
				<div className= "flex items-center justify-center w-[40px] h-[40px]">
					{ props.role === 'user' ? (
						<img
							src="https://source.boringavatars.com/marble/30/Maria%20user"
							alt="User"
						/>
					) : (
						<div className= "w-[30px] h-[30px] bg-emerald-400"/>
					) }
				</div>

                <div><Remark>{ props.content }</Remark></div>
            </div>
        </div>
    );
}
