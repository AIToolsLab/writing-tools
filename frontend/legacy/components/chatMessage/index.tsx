import { Remark } from 'react-remark';

type ChatMessageProps = {
	index: number;
	refresh: (_: number) => void;
	deleteMessage: (_: number) => void;
	convertToComment: (_: number) => void;
};

export default function ChatMessage(props: ChatMessage & ChatMessageProps) {
	return (
		<div
			className={`w-full mb-2 ${props.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}
		>
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
			<div
				className={`max-w-[85%] p-4 border rounded-lg ${
					props.role === 'user'
						? 'bg-blue-50 border-blue-300 mr-2'
						: 'bg-gray-50 border-gray-300 ml-2'
				}`}
			>
				<div className="text-gray-800">
					<Remark>{props.content}</Remark>
				</div>
			</div>
		</div>
	);
}
