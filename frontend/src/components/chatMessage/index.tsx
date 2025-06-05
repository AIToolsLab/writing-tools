import { Remark } from 'react-remark';
import { initials } from '@dicebear/collection';


type ChatMessageProps = {
	index: number;
	refresh: (_: number) => void;
	deleteMessage: (_: number) => void;
	convertToComment: (_: number) => void;
};

export default function ChatMessage(props: ChatMessage & ChatMessageProps) {
	return (
		<div className={ `w-full mb-2 ${props.role === 'user' ? 'flex justify-end' : 'flex justify-start'}` } >
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
				className={ `max-w-[85%] p-4 border rounded-lg flex gap-4 items-start ${
					props.role === 'user' ? 'bg-blue-50 border-blue-300 mr-2': 'bg-gray-50 border-gray-300 ml-2'}` }
			>
                
				<div className= "flex-shrink-0">
					{ props.role === 'user' ? (
						<img
							src="https://api.dicebear.com/9.x/initials/svg?seed=HY"
                            /*hardcoded for now, to change later with api, backgroundColor=00acc1,1e88e5,5e35b1,7cb342,8e24aa,039be5,43a047,00897b,3949ab,c0ca33,d81b60,e53935,f4511e,fb8c00,fdd835,ffb300*/
                            className="w-8 h-8"
						/>
					) : (
						<div className= "w-[30px] h-[30px] bg-emerald-400"/>
					) }
				</div>

                <div className="text-gray-800"><Remark>{ props.content }</Remark></div>
            </div>
        </div>
    );
}
