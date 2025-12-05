import { Remark } from 'react-remark';
import { Avatar } from 'reshaped';

type ChatMessageProps = {
	index: number;
	userName?: string;
	userPicture?: string;
	refresh: (_: number) => void;
	deleteMessage: (_: number) => void;
	convertToComment: (_: number) => void;
};

export default function ChatMessage(props: ChatMessage & ChatMessageProps) {
	const getAvatarSrc = () => {
		if (props.role === 'user') {
			// Use Auth0 picture if available, otherwise use initials avatar
			if (props.userPicture) {
				return props.userPicture;
			}
			const userName = props.userName || 'User';
			return `https://api.dicebear.com/9.x/initials/svg?seed=${encodeURIComponent(userName)}&backgroundColor=1e88e5`;
		} else {
			// AI assistant avatar
			return 'https://api.dicebear.com/9.x/bottts/svg?seed=AI&backgroundColor=10b981';
		}
	};

	return (
		<div
			className={`w-full flex ${props.role === 'user' ? 'justify-end' : 'justify-start'}`}
		>
			<div
				className={`max-w-[75%] p-5 rounded-xl flex gap-4 items-start shadow-sm ${
					props.role === 'user'
						? 'bg-blue-50 border border-blue-200'
						: 'bg-gray-50 border border-gray-200'
				}`}
			>
				<div className="flex-shrink-0">
					<Avatar
						src={getAvatarSrc()}
						size={10}
					/>
				</div>

				<div className="text-gray-800 flex-1 min-w-0 prose prose-sm max-w-none">
					<Remark>{props.content}</Remark>
				</div>
			</div>
		</div>
	);
}
