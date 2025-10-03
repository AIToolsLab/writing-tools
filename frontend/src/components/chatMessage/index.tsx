import { Remark } from 'react-remark';

type ChatMessageProps = {
	index: number;
	refresh: (_: number) => void;
	deleteMessage: (_: number) => void;
	convertToComment: (_: number) => void;
};

export default function ChatMessage(props: ChatMessage & ChatMessageProps) {
	const isUser = props.role === 'user';

	return (
		<div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
			<div
				className={`flex max-w-[75%] items-end gap-3 ${
					isUser ? 'flex-row-reverse text-right' : ''
				}`}
			>
				<div className="flex-shrink-0">
					{isUser ? (
						<img
							src="https://api.dicebear.com/9.x/initials/svg?seed=User"
							alt="User avatar"
							loading="lazy"
							className="h-10 w-10 rounded-full border-2 border-white shadow-sm ring-2 ring-sky-300/70"
						/>
					) : (
						<div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-xs font-semibold uppercase tracking-widest text-white shadow-sm ring-2 ring-emerald-200/80">
							AI
						</div>
					)}
				</div>

				<div
					className={`relative flex flex-col rounded-3xl px-4 py-3 text-[15px] leading-relaxed shadow-sm transition ${
						isUser
							? 'bg-gradient-to-r from-sky-500 via-sky-500 to-indigo-500 text-white'
							: 'border border-slate-200 bg-white text-slate-700'
					}`}
				>
					<div
						className={`whitespace-pre-wrap break-words ${
							isUser ? 'text-white/90' : 'text-slate-700'
						}`}
					>
						<Remark>{props.content}</Remark>
					</div>
				</div>
			</div>
		</div>
	);
}
