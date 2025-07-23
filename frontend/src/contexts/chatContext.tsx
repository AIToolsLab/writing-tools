import { type PropsWithChildren, createContext, useState } from 'react';

// Stores chat messages in a context so that they are saved when a user switches between tabs
export const ChatContext = createContext<{
	chatMessages: ChatMessage[];
	updateChatMessages: (chatMessages: ChatMessage[]) => void;
}>({
	chatMessages: [],
	updateChatMessages: (_chatMessages: ChatMessage[]) => {},
});

export default function ChatContextWrapper({
	children,
}: PropsWithChildren<any>) {
	const [chatMessages, updateChatMessages] = useState([] as ChatMessage[]);

	return (
		<ChatContext.Provider value={{ chatMessages, updateChatMessages }}>
			{children}
		</ChatContext.Provider>
	);
}
