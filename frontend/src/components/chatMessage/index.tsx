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
							src="https://api.dicebear.com/9.x/initials/svg?seed=HY"
                            /*hardcoded for now, to change later with api, backgroundColor=00acc1,1e88e5,5e35b1,7cb342,8e24aa,039be5,43a047,00897b,3949ab,c0ca33,d81b60,e53935,f4511e,fb8c00,fdd835,ffb300*/
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
